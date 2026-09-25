// views.js — reine Render-Funktionen. Kein Zustand, keine Event-Handler:
// die Ansichten setzen nur data-Attribute, das Binding macht app.js per
// Delegation. Dadurch bleibt Neuzeichnen billig und idempotent.

import {
  WEEKDAY_SHORT, MONTH_NAMES, MONTH_SHORT, ymd, hm, addDays, startOfWeek,
  startOfMonth, endOfMonth, isoDow, isoWeek, minutesOfDay, minutesToHm,
  daysInMonth, sameDay, pad,
} from './dates.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ */
/* Ueberlappungs-Layout                                                */
/* ------------------------------------------------------------------ */

/**
 * Weist sich ueberlappenden Terminen Spalten zu (Google-Calendar-Verfahren):
 * maximale Cluster zusammenhaengender Ueberlappung bilden, darin gierig in
 * die erste freie Spalte einsortieren. Setzt `_col` und `_cols` je Eintrag.
 */
export function layoutColumns(items) {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const groups = [];
  let group = [];
  let lastEnd = -Infinity;
  for (const it of sorted) {
    if (group.length && it.s >= lastEnd) { groups.push(group); group = []; lastEnd = -Infinity; }
    group.push(it);
    lastEnd = Math.max(lastEnd, it.e);
  }
  if (group.length) groups.push(group);

  for (const g of groups) {
    const cols = [];
    for (const it of g) {
      let placed = false;
      for (let i = 0; i < cols.length; i += 1) {
        if (cols[i][cols[i].length - 1].e <= it.s) { cols[i].push(it); it._col = i; placed = true; break; }
      }
      if (!placed) { cols.push([it]); it._col = cols.length - 1; }
    }
    for (const it of g) it._cols = cols.length;
  }
  return sorted;
}

/* ------------------------------------------------------------------ */
/* Lesbare Schriftfarbe auf einer Kategoriefarbe                       */
/* ------------------------------------------------------------------ */

const DARK_INK = '#111827';
const LIGHT_INK = '#ffffff';

/** '#rgb' oder '#rrggbb' -> [r, g, b] in 0..1, oder null. */
function parseHex(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/** Relative Leuchtdichte nach WCAG 2.1 (sRGB linearisiert). */
export function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Kontrastverhaeltnis zweier Farben nach WCAG 2.1. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const hell = Math.max(la, lb);
  const dunkel = Math.min(la, lb);
  return (hell + 0.05) / (dunkel + 0.05);
}

/**
 * Schrift auf farbigem Grund: die von beiden Tinten mit dem hoeheren
 * Kontrast. Bei hellen Kategoriefarben (Weiss, Gelb, aber auch Tuerkis oder
 * Bernstein) ist das die dunkle.
 *
 * Gerechnet wird gegen die TATSAECHLICHEN Tinten, nicht gegen reines Schwarz
 * und Weiss. `#111827` ist kein Schwarz; mit der idealisierten Formel kippte
 * die Entscheidung bei mittleren Farben wie Indigo in die falsche Richtung.
 *
 * Bei unlesbarer Farbangabe wird die dunkle Tinte gewaehlt: helle Schrift
 * auf unbekanntem Grund ist der gefaehrlichere Fehler.
 */
export function contrastText(hex) {
  if (luminance(hex) === null) return DARK_INK;
  return contrastRatio(hex, DARK_INK) >= contrastRatio(hex, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}

/* ------------------------------------------------------------------ */
/* Bausteine                                                           */
/* ------------------------------------------------------------------ */

/**
 * Anzeigetitel einer Instanz. Bei Geburtstagen wird das Alter aus dem
 * Jahrgang und dem Jahr DIESER Instanz berechnet — deshalb steht es nicht
 * im gespeicherten Titel, wo es fuer jedes andere Jahr falsch waere.
 */
export function titleOf(occ) {
  const t = occ.event.title || '(ohne Titel)';
  const by = occ.event.birthYear;
  if (!by) return t;
  const age = occ.start.getFullYear() - by;
  return age >= 0 && age < 200 ? `${t} (${age})` : t;
}

function chip(occ, color, { showTime = true } = {}) {
  const c = el('div', occ.allDay ? 'chip allday' : 'chip');
  c.style.setProperty('--c', color);
  c.style.setProperty('--fg', contrastText(color));
  c.dataset.ev = occ.event.id;
  c.dataset.occ = occ.occDate;
  const label = titleOf(occ);
  // Kein `title`-Attribut: den vollen Titel zeigt tooltip.js, und zwar nur,
  // wenn er abgeschnitten ist. Beides zusammen gaebe zwei Kaesten.
  if (!occ.allDay && showTime) c.append(el('span', 't', hm(occ.start)));
  c.append(el('span', 's', label));
  return c;
}

/** Chips entfernen, bis die Zelle nicht mehr ueberlaeuft, und "+N" anhaengen. */
export function collapseOverflow(cell) {
  const list = cell.querySelector('.mv-list');
  if (!list) return;
  const chips = [...list.children];
  let hidden = 0;
  const overflowing = () => list.scrollHeight > list.clientHeight + 1;
  if (!overflowing()) return;
  let more = el('div', 'chip more');
  list.append(more);
  for (let i = chips.length - 1; i >= 0 && overflowing(); i -= 1) {
    chips[i].remove();
    hidden += 1;
  }
  if (hidden === 0) { more.remove(); return; }
  more.textContent = `+${hidden} weitere`;
  more.dataset.date = cell.dataset.date;
}

/* ------------------------------------------------------------------ */
/* Monatsansicht                                                       */
/* ------------------------------------------------------------------ */

export function renderMonth(ctx) {
  const { cursor, selected, occurrences, colorOf, tasksByDate, today } = ctx;
  const root = el('div', 'mv');

  const head = el('div', 'mv-head');
  for (const d of WEEKDAY_SHORT) head.append(el('div', null, d));
  root.append(head);

  const first = startOfWeek(startOfMonth(cursor));
  const last = endOfMonth(cursor);
  const weeks = Math.ceil((Math.round((addDays(startOfWeek(last), 6) - first) / 86400000) + 1) / 7);

  const body = el('div', 'mv-body');
  body.style.gridTemplateRows = `repeat(${weeks}, minmax(0, 1fr))`;

  // Instanzen nach Tag vorsortieren: ganztaegige zuerst, dann nach Startzeit.
  const byDay = new Map();
  for (const o of occurrences) {
    const from = ymd(o.start);
    const to = o.allDay ? ymd(o.end) : ymd(o.end > o.start && hm(o.end) === '00:00' ? addDays(o.end, -1) : o.end);
    for (let d = from; d <= to;) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(o);
      const nd = addDays(new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)), 1);
      d = ymd(nd);
    }
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  }

  for (let w = 0; w < weeks; w += 1) {
    const row = el('div', 'mv-week');
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(first, w * 7 + i);
      const key = ymd(date);
      const cell = el('div', 'mv-cell');
      cell.dataset.date = key;
      if (date.getMonth() !== cursor.getMonth()) cell.classList.add('other');
      if (sameDay(date, today)) cell.classList.add('today');
      if (key === selected) cell.classList.add('selected');

      const num = el('div', 'mv-daynum', String(date.getDate()));
      if (date.getDate() === 1) num.textContent = `${date.getDate()}. ${MONTH_SHORT[date.getMonth()]}`;
      cell.append(num);

      const list = el('div', 'mv-list');
      list.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-height:0;overflow:hidden;flex:1';
      for (const o of (byDay.get(key) || [])) list.append(chip(o, colorOf(o.event.category)));
      cell.append(list);

      const openTasks = (tasksByDate.get(key) || []).filter((t) => !t.done).length;
      if (openTasks) cell.append(el('div', 'mv-taskdot', `☐ ${openTasks}`));

      row.append(cell);
    }
    body.append(row);
  }
  root.append(body);
  return root;
}

/* ------------------------------------------------------------------ */
/* Zeitraster: Woche (7 Spalten) und Tag (1 Spalte)                    */
/* ------------------------------------------------------------------ */

export function renderTimeGrid(ctx, days) {
  const { selected, occurrences, colorOf, today } = ctx;
  // Aeussere Huelle scrollt waagrecht (schmale Fenster), die innere Huelle
  // haelt Kopf, Ganztags-Zeile und das senkrecht scrollende Raster zusammen.
  const outer = el('div', days.length === 1 ? 'tg single' : 'tg');
  outer.style.setProperty('--cols', String(days.length));
  const root = el('div', 'tg-inner');
  outer.append(root);

  /* Kopf */
  const head = el('div', 'tg-head');
  head.append(el('div', 'corner'));
  for (const d of days) {
    const c = el('div', 'tg-daycol');
    c.dataset.date = ymd(d);
    if (sameDay(d, today)) c.classList.add('today');
    if (ymd(d) === selected) c.classList.add('selected');
    c.append(el('div', 'dow', WEEKDAY_SHORT[isoDow(d)]));
    c.append(el('div', 'num', String(d.getDate())));
    head.append(c);
  }
  root.append(head);

  /* Ganztaegige Zeile */
  const allday = el('div', 'tg-allday');
  allday.append(el('div', 'label', 'ganztägig'));
  let anyAllDay = false;
  for (const d of days) {
    const key = ymd(d);
    const slot = el('div', 'slot');
    slot.dataset.date = key;
    slot.dataset.allday = '1';
    for (const o of occurrences) {
      if (!o.allDay) continue;
      if (ymd(o.start) <= key && key <= ymd(o.end)) { slot.append(chip(o, colorOf(o.event.category))); anyAllDay = true; }
    }
    allday.append(slot);
  }
  if (anyAllDay) root.append(allday);

  /* Zeitraster */
  const scroll = el('div', 'tg-scroll');
  const grid = el('div', 'tg-grid');

  const gutter = el('div', 'tg-gutter');
  for (let h = 1; h < 24; h += 1) {
    const lbl = el('div', 'h', `${pad(h)}:00`);
    lbl.style.top = `${(h / 24) * 100}%`;
    gutter.append(lbl);
  }
  grid.append(gutter);

  for (const d of days) {
    const key = ymd(d);
    const col = el('div', 'tg-col');
    col.dataset.date = key;
    if (sameDay(d, today)) col.classList.add('today');
    if (isoDow(d) >= 5) col.classList.add('weekend');

    // Instanzen auf diesen Tag zuschneiden.
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0);
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0);
    const items = [];
    for (const o of occurrences) {
      if (o.allDay) continue;
      if (o.end <= dayStart || o.start >= dayEnd) continue;
      const s = Math.max(0, minutesOfDay(o.start) + (o.start < dayStart ? -minutesOfDay(o.start) : 0));
      const sMin = o.start < dayStart ? 0 : minutesOfDay(o.start);
      const eMin = o.end > dayEnd ? 1440 : (minutesOfDay(o.end) || (o.end > o.start ? 1440 : 0));
      items.push({ occ: o, s: sMin, e: Math.max(sMin + 15, eMin), clippedStart: o.start < dayStart, clippedEnd: o.end > dayEnd });
      void s;
    }

    for (const it of layoutColumns(items)) {
      const b = el('div', 'block');
      const color = colorOf(it.occ.event.category);
      b.style.setProperty('--c', color);
      b.dataset.ev = it.occ.event.id;
      b.dataset.occ = it.occ.occDate;
      b.dataset.date = key;
      b.style.top = `${(it.s / 1440) * 100}%`;
      b.style.height = `${((it.e - it.s) / 1440) * 100}%`;
      const width = 100 / it._cols;
      b.style.left = `calc(${it._col * width}% + 2px)`;
      b.style.width = `calc(${width}% - 4px)`;
      b.style.zIndex = String(1 + it._col);
      if (it.e - it.s < 40) b.classList.add('compact');
      b.append(el('div', 'bt', titleOf(it.occ)));
      b.append(el('div', 'bm', `${minutesToHm(it.s)}–${minutesToHm(it.e === 1440 ? 1439 : it.e)}`.replace('23:59', '24:00')));
      if (!it.clippedEnd) b.append(el('div', 'grip'));

      col.append(b);
    }

    if (sameDay(d, today)) {
      const now = new Date();
      const line = el('div', 'nowline');
      line.style.top = `${(minutesOfDay(now) / 1440) * 100}%`;
      col.append(line);
    }
    grid.append(col);
  }

  scroll.append(grid);
  root.append(scroll);
  return outer;
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

export function renderMiniMonth(ctx, miniCursor) {
  const { selected, daysWithEvents, today } = ctx;
  const wrap = el('div');

  const head = el('div', 'mini-head');
  const prev = el('button', 'ghost', '‹'); prev.dataset.mini = 'prev'; prev.setAttribute('aria-label', 'Vormonat');
  const next = el('button', 'ghost', '›'); next.dataset.mini = 'next'; next.setAttribute('aria-label', 'Folgemonat');
  head.append(prev, el('div', 'm', `${MONTH_NAMES[miniCursor.getMonth()]} ${miniCursor.getFullYear()}`), next);
  wrap.append(head);

  const grid = el('div', 'mini');
  for (const d of WEEKDAY_SHORT) grid.append(el('div', 'dh', d[0]));
  const first = startOfWeek(startOfMonth(miniCursor));
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(first, i);
    const key = ymd(date);
    const b = el('button', 'd', String(date.getDate()));
    b.dataset.goto = key;
    if (date.getMonth() !== miniCursor.getMonth()) b.classList.add('other');
    if (sameDay(date, today)) b.classList.add('today');
    if (key === selected) b.classList.add('sel');
    if (daysWithEvents.has(key)) b.classList.add('has');
    grid.append(b);
  }
  wrap.append(grid);
  return wrap;
}

export function renderTasks(tasks, dateYmd) {
  const ul = el('ul', 'tasks');
  if (!tasks.length) {
    ul.append(el('li', 'empty', 'Keine Aufgaben für diesen Tag.'));
    return ul;
  }
  for (const t of tasks) {
    const li = el('li', t.done ? 'done' : '');
    li.dataset.task = t.id;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.dataset.toggle = t.id;
    cb.id = `task-${t.id}`;
    cb.setAttribute('aria-label', t.title);
    const label = el('label', 'tt', t.title);
    label.setAttribute('for', `task-${t.id}`);
    const del = el('button', 'del', '×');
    del.dataset.deltask = t.id;
    del.setAttribute('aria-label', `Aufgabe "${t.title}" löschen`);
    li.append(cb, label, del);
    ul.append(li);
  }
  void dateYmd;
  return ul;
}

export function renderAgenda(occs, colorOf) {
  const ul = el('ul', 'agenda');
  if (!occs.length) {
    ul.append(el('li', 'empty', 'Keine Termine.'));
    return ul;
  }
  for (const o of occs) {
    const li = el('li');
    li.dataset.ev = o.event.id;
    li.dataset.occ = o.occDate;
    const dot = el('span', 'dot');
    dot.style.setProperty('--c', colorOf(o.event.category));
    li.append(dot, el('span', 'tm', o.allDay ? 'ganztg.' : hm(o.start)), el('span', 'tx', titleOf(o)));
    ul.append(li);
  }
  return ul;
}

export { el, daysInMonth, isoWeek };
