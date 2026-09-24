// plan.js — Wochen- und Tagesplanung.
//
// Drei Ebenen, jede eine Kopie der darueberliegenden:
//
//   Vorlage  --kopieren-->  Wochenplan  --kopieren-->  Tagesplan
//   (versioniert)           (+ Kalendertermine)
//
// Eine Ebene entsteht erst beim ersten Eingriff (copy-on-write). Solange
// ein Tagesplan nicht angelegt ist, zeigt die Tagesplanung den Tag aus dem
// Wochenplan; solange kein Wochenplan angelegt ist, zeigt die Wochenplanung
// die Vorschau aus Vorlage und Kalender. Ab dem ersten Eingriff ist die
// Ebene eigenstaendig: Aenderungen wirken nie nach oben.

import { WEEKDAY_SHORT, WEEKDAY_LONG, ymd, isoDow, sameDay, fmtDateLong, hm } from './dates.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ */
/* Termine des Kalenders als Plan-Eintraege                            */
/* ------------------------------------------------------------------ */

/** Instanzen -> { 'YYYY-MM-DD': [itemEntwurf, ...] }, gruppiert nach Tag. */
export function eventItemsByDate(occurrences) {
  const out = {};
  for (const o of occurrences) {
    const date = ymd(o.start);
    if (!out[date]) out[date] = [];
    out[date].push({
      title: o.event.title || '(ohne Titel)',
      start: o.allDay ? null : hm(o.start),
      end: o.allDay ? null : hm(o.end),
      category: o.event.category,
      note: '',
      source: 'event',
      // Eindeutig je Instanz, damit ein erneutes Uebernehmen nicht verdoppelt.
      srcId: `${o.event.id}|${o.occDate}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bausteine                                                           */
/* ------------------------------------------------------------------ */

function timeField(item, part, colorOf) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pl-time';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.placeholder = part === 'start' ? '–:–' : '';
  input.value = item[part] || '';
  input.dataset.plitem = item.id;
  input.dataset.plpart = part;
  input.setAttribute('aria-label', part === 'start' ? 'Beginn' : 'Ende');
  void colorOf;
  return input;
}

function planItem(item, colorOf, { readonly = false } = {}) {
  const node = el('div', `pl pl-${item.source}`);
  node.dataset.plan = item.id;
  node.style.setProperty('--c', colorOf(item.category));

  const handle = el('span', 'pl-handle', '⠿');
  handle.setAttribute('aria-hidden', 'true');
  handle.title = 'Ziehen ändert die Reihenfolge';

  const times = el('div', 'pl-times');
  times.append(timeField(item, 'start', colorOf), el('span', 'pl-dash', '–'), timeField(item, 'end', colorOf));

  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'pl-title';
  title.value = item.title;
  title.autocomplete = 'off';
  title.dataset.plitem = item.id;
  title.dataset.plpart = 'title';
  title.setAttribute('aria-label', 'Bezeichnung');

  const del = el('button', 'pl-del', '×');
  del.type = 'button';
  del.dataset.pldel = item.id;
  del.setAttribute('aria-label', `„${item.title}“ entfernen`);

  node.append(handle, times, title, del);
  if (item.source === 'event') node.title = 'Kopie aus dem Kalender — Änderungen wirken nicht zurück';
  if (item.source === 'template') node.title = 'Kopie aus der Vorlage — Änderungen wirken nicht zurück';
  if (readonly) {
    for (const i of node.querySelectorAll('input')) i.readOnly = true;
    del.remove();
  }
  return node;
}

function column(key, items, colorOf, { heading, today = false, selected = false } = {}) {
  const col = el('section', 'pl-col');
  col.dataset.plkey = key;
  if (today) col.classList.add('today');
  if (selected) col.classList.add('selected');
  if (heading) col.append(heading);

  const list = el('div', 'pl-list');
  list.dataset.plkey = key;
  for (const it of items) list.append(planItem(it, colorOf));
  if (!items.length) list.append(el('p', 'empty', 'Nichts geplant.'));
  col.append(list);

  const form = el('form', 'pl-add');
  form.dataset.plkey = key;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Eintrag…';
  input.autocomplete = 'off';
  input.dataset.pladd = key;
  input.setAttribute('aria-label', 'Neuer Eintrag');
  const add = el('button', 'primary', '+');
  add.type = 'submit';
  add.setAttribute('aria-label', 'Eintrag hinzufügen');
  form.append(input, add);
  col.append(form);
  return col;
}

function bar(children) {
  const b = el('div', 'pl-bar');
  for (const c of children) if (c) b.append(c);
  return b;
}

function button(label, dataset, cls = '') {
  const b = el('button', cls, label);
  b.type = 'button';
  Object.assign(b.dataset, dataset);
  return b;
}

/* ------------------------------------------------------------------ */
/* Wochenplanung                                                       */
/* ------------------------------------------------------------------ */

/**
 * ctx: {
 *   mode: 'week' | 'template',
 *   days: Date[7], dayKeys: string[7], itemsFor(key) -> items,
 *   materialized: bool, templates: [], activeTemplateId, templateLabel,
 *   pendingEvents: number, today, selected, colorOf
 * }
 */
export function renderWeekPlan(ctx) {
  const root = el('div', 'pl-page');

  /* Werkzeugleiste */
  const tools = [];
  const modeSwitch = el('div', 'segmented');
  const bWeek = button('Woche', { plmode: 'week' });
  const bTpl = button('Vorlage', { plmode: 'template' });
  bWeek.setAttribute('aria-pressed', String(ctx.mode === 'week'));
  bTpl.setAttribute('aria-pressed', String(ctx.mode === 'template'));
  modeSwitch.append(bWeek, bTpl);
  tools.push(modeSwitch);

  const select = document.createElement('select');
  select.id = 'pl-template';
  select.setAttribute('aria-label', 'Wochenvorlage');
  if (!ctx.templates.length) {
    const o = document.createElement('option');
    o.textContent = 'keine Vorlage vorhanden';
    o.value = '';
    select.append(o);
    select.disabled = true;
  } else {
    for (const t of ctx.templates) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = `${t.label} · ${t.createdAt.split('-').reverse().join('.')}`;
      if (t.id === ctx.activeTemplateId) o.selected = true;
      select.append(o);
    }
  }
  tools.push(select);
  tools.push(button('+ Vorlage', { plnewtemplate: '1' }));

  if (ctx.mode === 'week') {
    if (ctx.materialized) {
      tools.push(button(
        ctx.pendingEvents ? `Kalender übernehmen (${ctx.pendingEvents})` : 'Kalender übernehmen',
        { plsync: '1' },
        ctx.pendingEvents ? 'primary' : '',
      ));
      tools.push(button('Woche zurücksetzen', { plresetweek: '1' }, 'danger'));
    }
    const state = el('span', 'pl-state', ctx.materialized
      ? 'eigenständige Woche'
      : 'Vorschau aus Vorlage und Kalender — die erste Änderung legt die Woche an');
    tools.push(state);
  } else {
    tools.push(button('Vorlage löschen', { pldeltemplate: '1' }, 'danger'));
    tools.push(el('span', 'pl-state',
      'Änderungen legen automatisch eine Fassung mit dem heutigen Datum an'));
  }
  root.append(bar(tools));

  /* Spalten */
  const grid = el('div', 'pl-grid');
  if (ctx.mode === 'template') {
    for (let dow = 0; dow < 7; dow += 1) {
      const head = el('div', 'pl-head');
      head.append(el('div', 'pl-col-title', WEEKDAY_LONG[dow]));
      grid.append(column(String(dow), ctx.itemsFor(String(dow)), ctx.colorOf, { heading: head }));
    }
  } else {
    ctx.days.forEach((d, i) => {
      const key = ctx.dayKeys[i];
      const head = el('div', 'pl-head');
      const title = el('div', 'pl-col-title');
      title.dataset.plgoto = key;
      title.append(el('span', 'dow', WEEKDAY_SHORT[isoDow(d)]));
      title.append(el('span', 'num', String(d.getDate())));
      head.append(title);
      const items = ctx.itemsFor(key);
      head.append(el('div', 'pl-count', items.length ? String(items.length) : ''));
      grid.append(column(key, items, ctx.colorOf, {
        heading: head,
        today: sameDay(d, ctx.today),
        selected: key === ctx.selected,
      }));
    });
  }
  root.append(grid);
  return root;
}

/* ------------------------------------------------------------------ */
/* Tagesplanung                                                        */
/* ------------------------------------------------------------------ */

/**
 * ctx: { dateYmd, items, detached, colorOf, today }
 * `detached` = es gibt einen eigenen Tagesplan; sonst stammt die Anzeige
 * unveraendert aus dem Wochenplan.
 */
export function renderDayPlan(ctx) {
  const root = el('div', 'pl-page day');
  const d = new Date(+ctx.dateYmd.slice(0, 4), +ctx.dateYmd.slice(5, 7) - 1, +ctx.dateYmd.slice(8, 10));

  const tools = [];
  tools.push(el('span', 'pl-state', ctx.detached
    ? 'eigenständiger Tagesplan — vom Wochenplan gelöst'
    : 'aus dem Wochenplan übernommen — die erste Änderung löst den Tag'));
  if (ctx.detached) tools.push(button('Wieder aus Wochenplan holen', { plresetday: '1' }, 'danger'));
  root.append(bar(tools));

  const grid = el('div', 'pl-grid single');
  const head = el('div', 'pl-head');
  head.append(el('div', 'pl-col-title', fmtDateLong(d)));
  head.append(el('div', 'pl-count', ctx.items.length ? `${ctx.items.length} Einträge` : ''));
  grid.append(column(ctx.dateYmd, ctx.items, ctx.colorOf, {
    heading: head, today: sameDay(d, ctx.today),
  }));
  root.append(grid);
  return root;
}

/* ------------------------------------------------------------------ */
/* Ziehen: Reihenfolge und Spaltenwechsel                              */
/* ------------------------------------------------------------------ */

/**
 * Wie in tasks.js, aber ohne Hoehenaenderung. `onReorder(id, zielKey, index)`
 * feuert genau einmal beim Loslassen; waehrend der Geste wird nur das DOM
 * bewegt, damit die Geste nicht durch ein Neuzeichnen abreisst.
 */
export function attachPlanInteractions(root, { onReorder }) {
  let drag = null;

  const cleanup = () => {
    if (!drag) return;
    const { item, placeholder } = drag;
    item.classList.remove('pl-dragging');
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
    const item = e.target.closest('.pl');
    if (!item) return;
    if (e.target.closest('input, button, select')) return;

    const rect = item.getBoundingClientRect();
    const placeholder = el('div', 'pl-placeholder');
    placeholder.style.height = `${rect.height}px`;
    item.after(placeholder);
    drag = {
      item, placeholder, id: item.dataset.plan,
      dx: e.clientX - rect.left, dy: e.clientY - rect.top,
      width: rect.width, moved: false,
    };
    root.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.item.classList.add('pl-dragging');
      drag.item.style.position = 'fixed';
      drag.item.style.width = `${drag.width}px`;
      drag.item.style.pointerEvents = 'none';
      drag.item.style.zIndex = '200';
    }
    drag.item.style.left = `${e.clientX - drag.dx}px`;
    drag.item.style.top = `${e.clientY - drag.dy}px`;

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const list = under?.closest?.('.pl-list');
    if (!list) return;
    const siblings = [...list.querySelectorAll('.pl')].filter((n) => n !== drag.item);
    let before = null;
    for (const n of siblings) {
      const r = n.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { before = n; break; }
    }
    if (before) list.insertBefore(drag.placeholder, before);
    else list.append(drag.placeholder);
  });

  const finish = () => {
    if (!drag) return;
    const { id, placeholder, moved } = drag;
    const list = placeholder.closest('.pl-list');
    const targetKey = list?.dataset.plkey;
    const nodes = [...list.children].filter(
      (n) => (n.classList.contains('pl') && n !== drag.item) || n === placeholder);
    const index = nodes.indexOf(placeholder);
    cleanup();
    if (moved && targetKey && index >= 0) onReorder(id, targetKey, index);
  };

  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', cleanup);
}

export { el };
