// tasks.js — Aufgabenseite: Tages- und Wochenansicht.
//
// Aufgaben haben KEINE Uhrzeit. Zwei Dinge sind per Zeigergeste veraenderbar:
//   * die Reihenfolge — sie ist die geplante Abarbeitungsfolge,
//     innerhalb eines Tages und ueber Tagesgrenzen hinweg;
//   * die Hoehe des Blocks am Bildschirm — sie ist das Gewicht, das Leo der
//     Aufgabe gibt.
// Erledigte Aufgaben stehen immer unterhalb der offenen; das erzwingt die
// Sortierung beim Zeichnen, nicht die abgelegte Reihenfolge.

import {
  WEEKDAY_SHORT, ymd, addDays, isoDow, sameDay, fmtDateLong,
} from './dates.js';
import { MIN_TASK_HEIGHT, MAX_TASK_HEIGHT, DEFAULT_TASK_HEIGHT } from './store.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ */
/* Bausteine                                                           */
/* ------------------------------------------------------------------ */

function taskItem(t) {
  const item = el('div', t.done ? 'tk done' : 'tk');
  item.dataset.task = t.id;
  item.dataset.date = t.date;
  item.style.height = `${t.height || DEFAULT_TASK_HEIGHT}px`;

  const handle = el('span', 'tk-handle', '⠿');
  handle.setAttribute('aria-hidden', 'true');
  handle.title = 'Ziehen ändert die Reihenfolge';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!t.done;
  cb.dataset.tktoggle = t.id;
  cb.setAttribute('aria-label', `${t.title} erledigt`);

  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'tk-title';
  title.value = t.title;
  title.autocomplete = 'off';
  title.dataset.tktitle = t.id;
  title.setAttribute('aria-label', 'Aufgabentext');

  const del = el('button', 'tk-del', '×');
  del.type = 'button';
  del.dataset.tkdel = t.id;
  del.setAttribute('aria-label', `Aufgabe „${t.title}“ löschen`);

  const grip = el('div', 'tk-grip');
  grip.dataset.tkgrip = t.id;
  grip.title = 'Ziehen ändert die Höhe';

  item.append(handle, cb, title, del, grip);
  return item;
}

function dayColumn(dateYmd, tasks, { heading = null, today = false, selected = false } = {}) {
  const col = el('section', 'tk-col');
  col.dataset.date = dateYmd;
  if (today) col.classList.add('today');
  if (selected) col.classList.add('selected');

  if (heading) col.append(heading);

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const list = el('div', 'tk-list');
  list.dataset.date = dateYmd;
  for (const t of open) list.append(taskItem(t));

  if (done.length) {
    const sep = el('div', 'tk-sep');
    sep.append(el('span', null, `erledigt (${done.length})`));
    list.append(sep);
    for (const t of done) list.append(taskItem(t));
  }
  if (!tasks.length) list.append(el('p', 'empty', 'Nichts geplant.'));
  col.append(list);

  const form = el('form', 'tk-add');
  form.dataset.date = dateYmd;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Neue Aufgabe…';
  input.autocomplete = 'off';
  input.dataset.tkadd = dateYmd;
  input.setAttribute('aria-label', `Neue Aufgabe für ${dateYmd}`);
  const add = el('button', 'primary', '+');
  add.type = 'submit';
  add.setAttribute('aria-label', 'Aufgabe hinzufügen');
  form.append(input, add);
  col.append(form);

  return col;
}

/* ------------------------------------------------------------------ */
/* Ansichten                                                           */
/* ------------------------------------------------------------------ */

export function renderTaskDay(ctx) {
  const { dateYmd, tasksFor, today } = ctx;
  const root = el('div', 'tk-page day');
  const d = new Date(+dateYmd.slice(0, 4), +dateYmd.slice(5, 7) - 1, +dateYmd.slice(8, 10));
  const head = el('div', 'tk-head');
  head.append(el('div', 'tk-day-title', fmtDateLong(d)));
  const tasks = tasksFor(dateYmd);
  const open = tasks.filter((t) => !t.done).length;
  head.append(el('div', 'tk-count', tasks.length
    ? `${open} offen von ${tasks.length}`
    : 'keine Aufgaben'));
  root.append(dayColumn(dateYmd, tasks, { heading: head, today: sameDay(d, today) }));
  return root;
}

export function renderTaskWeek(ctx) {
  const { days, tasksFor, today, selected } = ctx;
  const root = el('div', 'tk-page week');
  for (const d of days) {
    const key = ymd(d);
    const head = el('div', 'tk-head');
    const title = el('div', 'tk-col-title');
    title.dataset.gotoday = key;
    title.append(el('span', 'dow', WEEKDAY_SHORT[isoDow(d)]));
    title.append(el('span', 'num', String(d.getDate())));
    head.append(title);
    const tasks = tasksFor(key);
    const open = tasks.filter((t) => !t.done).length;
    head.append(el('div', 'tk-count', tasks.length ? `${open}/${tasks.length}` : ''));
    root.append(dayColumn(key, tasks, {
      heading: head,
      today: sameDay(d, today),
      selected: key === selected,
    }));
  }
  return root;
}

/* ------------------------------------------------------------------ */
/* Ziehen: Reihenfolge und Hoehe                                       */
/* ------------------------------------------------------------------ */

/**
 * Haengt die Zeigergesten an den Wurzelknoten der Aufgabenseite.
 *
 * `onReorder(taskId, targetDate, index)` wird genau einmal beim Loslassen
 * gerufen, `onResize(taskId, height)` ebenso. Waehrend der Geste wird nur
 * das DOM bewegt — kein Neuzeichnen, sonst reisst die Geste ab.
 */
export function attachTaskInteractions(root, { onReorder, onResize }) {
  let drag = null;
  let resize = null;

  const cleanupDrag = () => {
    if (!drag) return;
    const { item, placeholder } = drag;
    item.classList.remove('tk-dragging');
    item.style.position = '';
    item.style.left = '';
    item.style.top = '';
    item.style.width = '';
    item.style.pointerEvents = '';
    item.style.zIndex = '';
    placeholder.replaceWith(item);
    drag = null;
  };

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    const grip = e.target.closest('[data-tkgrip]');
    if (grip) {
      const item = grip.closest('.tk');
      resize = { id: grip.dataset.tkgrip, item, startY: e.clientY, startH: item.offsetHeight };
      item.setPointerCapture(e.pointerId);
      item.classList.add('tk-resizing');
      e.preventDefault();
      return;
    }

    const item = e.target.closest('.tk');
    if (!item) return;
    // Bedienelemente im Block duerfen keine Geste ausloesen.
    if (e.target.closest('input, button')) return;

    const rect = item.getBoundingClientRect();
    const placeholder = el('div', 'tk-placeholder');
    placeholder.style.height = `${rect.height}px`;
    item.after(placeholder);

    drag = {
      item,
      placeholder,
      id: item.dataset.task,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      width: rect.width,
      moved: false,
    };
    root.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  root.addEventListener('pointermove', (e) => {
    if (resize) {
      const h = Math.max(MIN_TASK_HEIGHT,
        Math.min(MAX_TASK_HEIGHT, Math.round((resize.startH + (e.clientY - resize.startY)) / 2) * 2));
      resize.item.style.height = `${h}px`;
      return;
    }
    if (!drag) return;

    if (!drag.moved) {
      drag.moved = true;
      drag.item.classList.add('tk-dragging');
      drag.item.style.position = 'fixed';
      drag.item.style.width = `${drag.width}px`;
      drag.item.style.pointerEvents = 'none';
      drag.item.style.zIndex = '200';
    }
    drag.item.style.left = `${e.clientX - drag.dx}px`;
    drag.item.style.top = `${e.clientY - drag.dy}px`;

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const list = under?.closest?.('.tk-list');
    if (!list) return;

    const siblings = [...list.querySelectorAll('.tk')].filter((n) => n !== drag.item);
    let before = null;
    for (const n of siblings) {
      const r = n.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { before = n; break; }
    }
    if (before) list.insertBefore(drag.placeholder, before);
    else list.append(drag.placeholder);
  });

  const finish = (e) => {
    if (resize) {
      const { id, item } = resize;
      const h = item.offsetHeight;
      item.classList.remove('tk-resizing');
      resize = null;
      onResize(id, h);
      return;
    }
    if (!drag) return;
    const { id, placeholder, moved } = drag;
    const list = placeholder.closest('.tk-list');
    const targetDate = list?.dataset.date;
    // Index unter den ANDEREN Aufgaben der Zielliste. Der gezogene Block
    // haengt beim Ziehen innerhalb derselben Liste noch im DOM; zaehlte man
    // ihn mit, waere der Index um eins verschoben.
    const nodes = [...list.children].filter(
      (n) => (n.classList.contains('tk') && n !== drag.item) || n === placeholder);
    const index = nodes.indexOf(placeholder);
    cleanupDrag();
    if (moved && targetDate && index >= 0) onReorder(id, targetDate, index);
    void e;
  };

  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', () => {
    if (resize) { resize.item.classList.remove('tk-resizing'); resize = null; }
    cleanupDrag();
  });
}

export { el };
