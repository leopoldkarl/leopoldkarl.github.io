// app.js — Controller: Zustand der Ansicht, Ereignis-Bindung, Dialoge.

import {
  ymd, hm, ymdhm, parseYmd, parseLocal, addDays, addMonths, startOfWeek,
  startOfMonth, endOfMonth, isoDow, isoWeek, minutesToHm, MONTH_NAMES,
  fmtDateLong, pad, sameDay, diffDays, startOfDay,
} from './dates.js';
import { Store, LocalStorageAdapter, uid } from './store.js';
import { occurrencesInRange, describeRule } from './recurrence.js';
import { toICS, parseICS } from './ics.js';
import {
  renderMonth, renderTimeGrid, renderMiniMonth, renderTasks, renderAgenda,
  collapseOverflow, el,
} from './views.js';

const adapter = new LocalStorageAdapter('kalender.v1');
const store = new Store(adapter);

const ui = {
  view: localStorage_get('kalender.view', 'week'),
  cursor: new Date(),
  selected: ymd(new Date()),
  miniCursor: startOfMonth(new Date()),
  scrollTop: null,
};

const undoStack = [];

/* ------------------------------------------------------------------ */
/* kleine Helfer                                                       */
/* ------------------------------------------------------------------ */

function localStorage_get(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function localStorage_set(key, value) {
  try { localStorage.setItem(key, value); } catch { /* egal */ }
}

const $ = (sel) => document.querySelector(sel);

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function colorOf(catId) { return store.category(catId).color; }

function pushUndo(label) {
  undoStack.push({ label, snapshot: JSON.stringify(store.state) });
  if (undoStack.length > 25) undoStack.shift();
}

function undo() {
  const last = undoStack.pop();
  if (!last) { toast('Nichts rückgängig zu machen.'); return; }
  const restored = JSON.parse(last.snapshot);
  store.mutate((s) => {
    s.events = restored.events;
    s.tasks = restored.tasks;
    s.categories = restored.categories;
    s.settings = restored.settings;
  });
  toast(`Rückgängig: ${last.label}`);
}

function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/* Sichtbarer Zeitbereich                                              */
/* ------------------------------------------------------------------ */

function visibleDays() {
  if (ui.view === 'day') return [startOfDay(ui.cursor)];
  if (ui.view === 'week') {
    const s = startOfWeek(ui.cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const first = startOfWeek(startOfMonth(ui.cursor));
  const last = endOfMonth(ui.cursor);
  const weeks = Math.ceil((diffDays(first, addDays(startOfWeek(last), 6)) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
}

function periodLabel() {
  const c = ui.cursor;
  if (ui.view === 'day') return fmtDateLong(c);
  if (ui.view === 'week') {
    const s = startOfWeek(c);
    const e = addDays(s, 6);
    const sameMonth = s.getMonth() === e.getMonth();
    const left = sameMonth ? `${s.getDate()}.` : `${s.getDate()}. ${MONTH_NAMES[s.getMonth()]}`;
    return `${left} – ${e.getDate()}. ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`;
  }
  return `${MONTH_NAMES[c.getMonth()]} ${c.getFullYear()}`;
}

/* ------------------------------------------------------------------ */
/* Rendern                                                             */
/* ------------------------------------------------------------------ */

function render() {
  const days = visibleDays();
  const from = startOfDay(days[0]);
  const to = addDays(startOfDay(days[days.length - 1]), 1);
  const occurrences = occurrencesInRange(store.state.events, from, to);

  const tasksByDate = new Map();
  for (const t of store.state.tasks) {
    if (!tasksByDate.has(t.date)) tasksByDate.set(t.date, []);
    tasksByDate.get(t.date).push(t);
  }

  // Punkte im Mini-Monat: eigener Bereich, unabhaengig von der Hauptansicht.
  const miniFrom = startOfWeek(startOfMonth(ui.miniCursor));
  const miniTo = addDays(miniFrom, 42);
  const daysWithEvents = new Set();
  for (const o of occurrencesInRange(store.state.events, miniFrom, miniTo)) {
    for (let d = new Date(o.start); d <= o.end; d = addDays(d, 1)) daysWithEvents.add(ymd(d));
  }

  const ctx = {
    cursor: ui.cursor,
    selected: ui.selected,
    occurrences,
    colorOf,
    tasksByDate,
    daysWithEvents,
    today: new Date(),
  };

  const viewport = $('#viewport');
  const prevScroll = viewport.querySelector('.tg-scroll')?.scrollTop ?? null;

  let node;
  if (ui.view === 'month') node = renderMonth(ctx);
  else node = renderTimeGrid(ctx, days);
  viewport.replaceChildren(node);

  if (ui.view === 'month') {
    for (const cell of viewport.querySelectorAll('.mv-cell')) collapseOverflow(cell);
  } else {
    const sc = viewport.querySelector('.tg-scroll');
    if (sc) {
      const hourH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-h')) || 48;
      sc.scrollTop = prevScroll ?? ui.scrollTop ?? (store.state.settings.scrollHour * hourH - 12);
      ui.scrollTop = sc.scrollTop;
      sc.addEventListener('scroll', () => { ui.scrollTop = sc.scrollTop; }, { passive: true });
    }
  }

  /* Kopfleiste */
  const kw = ui.view === 'month' ? '' : ` <span class="kw">KW ${isoWeek(ui.cursor)}</span>`;
  $('#period').innerHTML = escapeHtml(periodLabel()) + kw;
  for (const b of document.querySelectorAll('[data-view]')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === ui.view));
  }

  /* Sidebar */
  $('#mini').replaceChildren(renderMiniMonth(ctx, ui.miniCursor));

  const selDate = parseYmd(ui.selected);
  $('#sel-date').textContent = fmtDateLong(selDate);

  const dayOccs = occurrencesInRange(store.state.events, startOfDay(selDate), addDays(startOfDay(selDate), 1))
    .filter((o) => ymd(o.start) <= ui.selected && ui.selected <= ymd(o.allDay ? o.end : o.end))
    .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  $('#agenda').replaceChildren(renderAgenda(dayOccs, colorOf));

  const tasks = store.tasksFor(ui.selected);
  $('#tasklist').replaceChildren(renderTasks(tasks, ui.selected));
  const open = tasks.filter((t) => !t.done).length;
  $('#task-count').textContent = tasks.length ? `${open} offen von ${tasks.length}` : '';

  $('#storage-warning').hidden = !adapter.degraded;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function setView(v) {
  ui.view = v;
  ui.scrollTop = null;
  localStorage_set('kalender.view', v);
  render();
}

function step(dir) {
  if (ui.view === 'month') ui.cursor = addMonths(ui.cursor, dir);
  else if (ui.view === 'week') ui.cursor = addDays(ui.cursor, 7 * dir);
  else ui.cursor = addDays(ui.cursor, dir);
  ui.miniCursor = startOfMonth(ui.cursor);
  if (ui.view === 'day') ui.selected = ymd(ui.cursor);
  render();
}

function goToday() {
  ui.cursor = new Date();
  ui.selected = ymd(ui.cursor);
  ui.miniCursor = startOfMonth(ui.cursor);
  ui.scrollTop = null;
  render();
}

function selectDate(key, { focusView = false } = {}) {
  ui.selected = key;
  const d = parseYmd(key);
  if (focusView || ui.view === 'day') ui.cursor = d;
  else if (ui.view === 'week' && (d < startOfWeek(ui.cursor) || d > addDays(startOfWeek(ui.cursor), 6))) ui.cursor = d;
  else if (ui.view === 'month' && d.getMonth() !== ui.cursor.getMonth()) ui.cursor = d;
  render();
}

/* ------------------------------------------------------------------ */
/* Termin-Dialog                                                       */
/* ------------------------------------------------------------------ */

const dlg = () => $('#event-dialog');
let editing = null; // { id, occDate, isNew, isSeries }

function openEventDialog(init, meta = {}) {
  editing = { id: meta.id || null, occDate: meta.occDate || null, isNew: !meta.id, isSeries: !!meta.isSeries };

  $('#f-title').value = init.title || '';
  $('#f-allday').checked = !!init.allDay;
  const startD = String(init.start).slice(0, 10);
  const endD = String(init.end || init.start).slice(0, 10);
  $('#f-date').value = startD;
  $('#f-enddate').value = endD;
  $('#f-from').value = init.allDay ? '09:00' : String(init.start).slice(11, 16) || '09:00';
  $('#f-to').value = init.allDay ? '10:00' : String(init.end).slice(11, 16) || '10:00';
  $('#f-notes').value = init.notes || '';

  const cat = init.category || store.state.settings.defaultCategory;
  for (const r of document.querySelectorAll('input[name="cat"]')) r.checked = (r.value === cat);

  const r = init.rrule;
  $('#f-freq').value = r ? r.freq : 'NONE';
  $('#f-interval').value = r ? r.interval : 1;
  for (const cb of document.querySelectorAll('input[name="byday"]')) {
    cb.checked = !!(r && r.byDay && r.byDay.includes(Number(cb.value)));
  }
  if (r && r.count) { $('#f-endmode').value = 'count'; $('#f-count').value = r.count; $('#f-until').value = ''; }
  else if (r && r.until) { $('#f-endmode').value = 'until'; $('#f-until').value = r.until; $('#f-count').value = 10; }
  else { $('#f-endmode').value = 'never'; $('#f-count').value = 10; $('#f-until').value = ''; }

  $('#dlg-title').textContent = editing.isNew ? 'Neuer Termin' : 'Termin bearbeiten';
  $('#btn-delete').hidden = editing.isNew;
  $('#scope-row').hidden = !(editing.isSeries && !editing.isNew);
  $('#scope-one').checked = true;

  syncDialogState();
  dlg().showModal();
  $('#f-title').focus();
  $('#f-title').select();
}

function syncDialogState() {
  const allDay = $('#f-allday').checked;
  $('#time-row').hidden = allDay;
  $('#enddate-row').hidden = !allDay;
  const freq = $('#f-freq').value;
  $('#rec-detail').hidden = freq === 'NONE';
  $('#byday-row').hidden = freq !== 'WEEKLY';
  $('#f-unit').textContent = { DAILY: 'Tage', WEEKLY: 'Wochen', MONTHLY: 'Monate', YEARLY: 'Jahre' }[freq] || '';
  const mode = $('#f-endmode').value;
  $('#f-count').hidden = mode !== 'count';
  $('#f-until').hidden = mode !== 'until';
}

function readDialog() {
  const allDay = $('#f-allday').checked;
  const d = $('#f-date').value;
  if (!d) return null;
  let start; let end;
  if (allDay) {
    start = d;
    end = $('#f-enddate').value || d;
    if (end < start) end = start;
  } else {
    const from = $('#f-from').value || '09:00';
    let toT = $('#f-to').value || from;
    start = `${d}T${from}`;
    end = `${d}T${toT}`;
    if (end <= start) {
      // Ueber Mitternacht: Ende auf den Folgetag legen.
      end = `${ymd(addDays(parseYmd(d), 1))}T${toT}`;
    }
  }

  const freq = $('#f-freq').value;
  let rrule = null;
  if (freq !== 'NONE') {
    const byDay = freq === 'WEEKLY'
      ? [...document.querySelectorAll('input[name="byday"]:checked')].map((c) => Number(c.value))
      : null;
    const mode = $('#f-endmode').value;
    rrule = {
      freq,
      interval: Math.max(1, parseInt($('#f-interval').value, 10) || 1),
      byDay: byDay && byDay.length ? byDay : null,
      count: mode === 'count' ? Math.max(1, parseInt($('#f-count').value, 10) || 1) : null,
      until: mode === 'until' ? ($('#f-until').value || null) : null,
    };
  }

  return {
    title: $('#f-title').value.trim() || '(ohne Titel)',
    allDay,
    start,
    end,
    category: document.querySelector('input[name="cat"]:checked')?.value || 'sonstiges',
    notes: $('#f-notes').value,
    rrule,
  };
}

function saveDialog() {
  const data = readDialog();
  if (!data) return;

  if (editing.isNew) {
    pushUndo('Termin angelegt');
    store.addEvent(data);
  } else if (editing.isSeries && $('#scope-one').checked) {
    // Nur diese Instanz: aus der Serie ausnehmen und als eigenen Termin anlegen.
    pushUndo('Einzeltermin aus Serie gelöst');
    store.excludeOccurrence(editing.id, editing.occDate);
    store.addEvent({ ...data, id: uid(), rrule: null, exdates: [] });
  } else {
    pushUndo('Termin geändert');
    const existing = store.state.events.find((e) => e.id === editing.id);
    const patch = { ...data };
    if (editing.isSeries) patch.exdates = existing ? existing.exdates : [];
    store.updateEvent(editing.id, patch);
  }
  dlg().close();
  render();
}

function deleteFromDialog() {
  if (!editing || editing.isNew) return;
  if (editing.isSeries && $('#scope-one').checked) {
    pushUndo('Einzeltermin gelöscht');
    store.excludeOccurrence(editing.id, editing.occDate);
    toast('Dieser Termin wurde aus der Serie entfernt.');
  } else {
    pushUndo(editing.isSeries ? 'Serie gelöscht' : 'Termin gelöscht');
    store.deleteEvent(editing.id);
    toast('Termin gelöscht.');
  }
  dlg().close();
  render();
}

function editOccurrence(evId, occDate) {
  const ev = store.state.events.find((e) => e.id === evId);
  if (!ev) return;
  const init = { ...ev };
  // Dialog auf die angeklickte Instanz setzen, nicht auf DTSTART der Serie.
  if (ev.rrule && occDate) {
    if (ev.allDay) {
      const span = diffDays(parseYmd(ev.start), parseYmd(ev.end));
      init.start = occDate;
      init.end = ymd(addDays(parseYmd(occDate), span));
    } else {
      init.start = `${occDate}T${String(ev.start).slice(11, 16)}`;
      const durMin = (parseLocal(ev.end) - parseLocal(ev.start)) / 60000;
      init.end = ymdhm(new Date(parseLocal(init.start).getTime() + durMin * 60000));
    }
  }
  openEventDialog(init, { id: ev.id, occDate, isSeries: !!ev.rrule });
}

function newEventAt(dateYmd, minutes) {
  const snapped = minutes == null ? null : Math.round(minutes / 15) * 15;
  if (snapped == null) {
    openEventDialog({
      title: '', allDay: false,
      start: `${dateYmd}T09:00`, end: `${dateYmd}T10:00`,
      category: store.state.settings.defaultCategory, rrule: null,
    });
  } else {
    const s = Math.min(snapped, 1440 - 30);
    openEventDialog({
      title: '', allDay: false,
      start: `${dateYmd}T${minutesToHm(s)}`,
      end: `${dateYmd}T${minutesToHm(Math.min(1439, s + 60))}`,
      category: store.state.settings.defaultCategory, rrule: null,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Drag & Drop / Resize im Zeitraster                                  */
/* ------------------------------------------------------------------ */

let drag = null;

function onPointerDown(e) {
  const block = e.target.closest('.block');
  if (!block || e.button !== 0) return;
  const col = block.closest('.tg-col');
  const grid = block.closest('.tg-grid');
  if (!col || !grid) return;

  const ev = store.state.events.find((x) => x.id === block.dataset.ev);
  if (!ev) return;

  const colRect = col.getBoundingClientRect();
  drag = {
    block, ev, occDate: block.dataset.occ,
    mode: e.target.classList.contains('grip') ? 'resize' : 'move',
    startX: e.clientX, startY: e.clientY,
    pxPerMin: colRect.height / 1440,
    colWidth: colRect.width,
    moved: false,
    origTop: parseFloat(block.style.top),
    origHeight: parseFloat(block.style.height),
    dayDelta: 0, minDelta: 0,
  };
  block.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPointerMove(e) {
  if (!drag) return;
  const dy = e.clientY - drag.startY;
  const dx = e.clientX - drag.startX;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  drag.block.classList.add('dragging');

  drag.minDelta = Math.round((dy / drag.pxPerMin) / 15) * 15;
  drag.dayDelta = drag.mode === 'move' ? Math.round(dx / drag.colWidth) : 0;

  if (drag.mode === 'move') {
    drag.block.style.top = `${drag.origTop + (drag.minDelta / 1440) * 100}%`;
    drag.block.style.transform = `translateX(${drag.dayDelta * drag.colWidth}px)`;
  } else {
    const h = Math.max((15 / 1440) * 100, drag.origHeight + (drag.minDelta / 1440) * 100);
    drag.block.style.height = `${h}%`;
  }
}

function onPointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.block.classList.remove('dragging');
  d.block.style.transform = '';

  // Wichtig: bei einem blossen Klick NICHT neu rendern. Ein render() hier
  // haengt den Block aus dem DOM aus, bevor das click-Ereignis zugestellt
  // wird; die Delegation auf #viewport wuerde es dann nie sehen und der
  // Bearbeiten-Dialog ginge nicht auf.
  if (!d.moved || (d.minDelta === 0 && d.dayDelta === 0)) {
    if (d.moved) {
      d.block.style.top = `${d.origTop}%`;
      d.block.style.height = `${d.origHeight}%`;
    }
    return;
  }

  const ev = d.ev;
  const occStart = parseLocal(`${d.occDate}T${String(ev.start).slice(11, 16)}`);
  const durMin = (parseLocal(ev.end) - parseLocal(ev.start)) / 60000;

  let newStart; let newEnd;
  if (d.mode === 'move') {
    newStart = new Date(occStart.getTime() + d.minDelta * 60000);
    newStart = addDays(newStart, d.dayDelta);
    newEnd = new Date(newStart.getTime() + durMin * 60000);
  } else {
    newStart = occStart;
    newEnd = new Date(occStart.getTime() + Math.max(15, durMin + d.minDelta) * 60000);
  }

  if (ev.rrule) {
    // Eine einzelne Instanz zu verschieben ist mehrdeutig. Die konservative
    // Auflegung: Instanz aus der Serie loesen statt die ganze Serie zu bewegen.
    pushUndo('Termin verschoben (aus Serie gelöst)');
    store.excludeOccurrence(ev.id, d.occDate);
    store.addEvent({
      ...ev, id: uid(), rrule: null, exdates: [],
      start: ymdhm(newStart), end: ymdhm(newEnd),
    });
    toast('Einzeltermin aus der Serie gelöst.');
  } else {
    pushUndo('Termin verschoben');
    store.updateEvent(ev.id, { start: ymdhm(newStart), end: ymdhm(newEnd) });
  }
  render();
}

/* ------------------------------------------------------------------ */
/* Aufgaben                                                            */
/* ------------------------------------------------------------------ */

function addTaskFromInput() {
  const input = $('#task-input');
  const title = input.value.trim();
  if (!title) return;
  pushUndo('Aufgabe angelegt');
  store.addTask(ui.selected, title);
  input.value = '';
  render();
  input.focus();
}

/* ------------------------------------------------------------------ */
/* Import / Export                                                     */
/* ------------------------------------------------------------------ */

function exportIcs() {
  download(`kalender-${ymd(new Date())}.ics`, toICS(store.state), 'text/calendar;charset=utf-8');
  toast('ics-Datei erzeugt.');
}

function exportJson() {
  download(`kalender-backup-${ymd(new Date())}.json`, store.exportJSON(), 'application/json');
  toast('Backup erzeugt.');
}

async function handleImportFile(file, mode) {
  const text = await file.text();
  pushUndo('Import');
  try {
    if (file.name.toLowerCase().endsWith('.json')) {
      store.importJSON(text, { merge: mode === 'merge' });
      toast('Backup eingelesen.');
    } else {
      const { events, tasks, skipped } = parseICS(text, store.state.categories);
      store.mutate((s) => {
        if (mode === 'replace') { s.events = []; s.tasks = []; }
        const known = new Set(s.events.map((e) => e.id));
        for (const e of events) if (!known.has(e.id)) s.events.push(e);
        const kt = new Set(s.tasks.map((t) => t.id));
        for (const t of tasks) if (!kt.has(t.id)) s.tasks.push(t);
      });
      toast(`${events.length} Termine, ${tasks.length} Aufgaben importiert`
        + (skipped ? `, ${skipped} übersprungen.` : '.'));
    }
  } catch (err) {
    console.error(err);
    toast('Datei konnte nicht gelesen werden.');
    undoStack.pop();
  }
  render();
}

/* ------------------------------------------------------------------ */
/* Bindung                                                             */
/* ------------------------------------------------------------------ */

function bind() {
  $('#btn-today').addEventListener('click', goToday);
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }
  $('#btn-new').addEventListener('click', () => newEventAt(ui.selected, null));
  $('#btn-menu').addEventListener('click', () => $('#menu-dialog').showModal());

  /* Hauptansicht: Delegation */
  const viewport = $('#viewport');
  viewport.addEventListener('click', (e) => {
    const more = e.target.closest('.chip.more');
    if (more) { ui.view = 'day'; ui.cursor = parseYmd(more.dataset.date); ui.selected = more.dataset.date; render(); return; }

    const chipEl = e.target.closest('.chip');
    if (chipEl && chipEl.dataset.ev) { editOccurrence(chipEl.dataset.ev, chipEl.dataset.occ); return; }

    const block = e.target.closest('.block');
    if (block) { editOccurrence(block.dataset.ev, block.dataset.occ); return; }

    const headCol = e.target.closest('.tg-daycol');
    if (headCol) { ui.view = 'day'; ui.cursor = parseYmd(headCol.dataset.date); ui.selected = headCol.dataset.date; render(); return; }

    const slot = e.target.closest('.tg-allday .slot');
    if (slot) {
      openEventDialog({
        title: '', allDay: true, start: slot.dataset.date, end: slot.dataset.date,
        category: store.state.settings.defaultCategory, rrule: null,
      });
      return;
    }

    const cell = e.target.closest('.mv-cell');
    if (cell) { selectDate(cell.dataset.date); return; }

    const col = e.target.closest('.tg-col');
    if (col) {
      const rect = col.getBoundingClientRect();
      const minutes = ((e.clientY - rect.top) / rect.height) * 1440;
      newEventAt(col.dataset.date, minutes);
    }
  });

  viewport.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.mv-cell');
    if (cell && !e.target.closest('.chip')) newEventAt(cell.dataset.date, null);
  });

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);

  /* Sidebar */
  $('#mini').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-mini]');
    if (nav) { ui.miniCursor = addMonths(ui.miniCursor, nav.dataset.mini === 'prev' ? -1 : 1); render(); return; }
    const b = e.target.closest('[data-goto]');
    if (b) selectDate(b.dataset.goto);
  });

  $('#agenda').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-ev]');
    if (li) editOccurrence(li.dataset.ev, li.dataset.occ);
  });

  $('#tasklist').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-toggle]');
    if (cb) { pushUndo('Aufgabe umgeschaltet'); store.updateTask(cb.dataset.toggle, { done: cb.checked }); render(); }
  });
  $('#tasklist').addEventListener('click', (e) => {
    const del = e.target.closest('[data-deltask]');
    if (del) { pushUndo('Aufgabe gelöscht'); store.deleteTask(del.dataset.deltask); render(); }
  });
  $('#task-add-form').addEventListener('submit', (e) => { e.preventDefault(); addTaskFromInput(); });
  $('#btn-carry').addEventListener('click', () => {
    pushUndo('Offene Aufgaben übernommen');
    const n = store.carryOverOpenTasks(ui.selected);
    toast(n ? `${n} offene Aufgabe${n === 1 ? '' : 'n'} übernommen.` : 'Nichts zu übernehmen.');
    render();
  });

  /* Termin-Dialog */
  $('#event-form').addEventListener('submit', (e) => { e.preventDefault(); saveDialog(); });
  $('#btn-delete').addEventListener('click', (e) => { e.preventDefault(); deleteFromDialog(); });
  $('#btn-cancel').addEventListener('click', (e) => { e.preventDefault(); dlg().close(); });
  for (const id of ['#f-allday', '#f-freq', '#f-endmode']) {
    $(id).addEventListener('change', syncDialogState);
  }
  $('#f-date').addEventListener('change', () => {
    if ($('#f-allday').checked && $('#f-enddate').value < $('#f-date').value) {
      $('#f-enddate').value = $('#f-date').value;
    }
  });

  /* Menue */
  $('#btn-export-ics').addEventListener('click', exportIcs);
  $('#btn-export-json').addEventListener('click', exportJson);
  $('#btn-import').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mode = document.querySelector('input[name="impmode"]:checked')?.value || 'merge';
    await handleImportFile(file, mode);
    e.target.value = '';
    $('#menu-dialog').close();
  });
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : (cur === 'light' ? '' : 'dark');
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    localStorage_set('kalender.theme', next);
  });
  $('#btn-menu-close').addEventListener('click', () => $('#menu-dialog').close());

  /* Tastatur */
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); render(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    switch (e.key) {
      case 'ArrowLeft': step(-1); break;
      case 'ArrowRight': step(1); break;
      case 'm': case 'M': setView('month'); break;
      case 'w': case 'W': setView('week'); break;
      case 'd': case 'D': setView('day'); break;
      case 't': case 'T': case 'h': case 'H': goToday(); break;
      case 'n': case 'N': e.preventDefault(); newEventAt(ui.selected, null); break;
      default: return;
    }
  });

  window.addEventListener('beforeunload', () => { store.flush(); });
  window.addEventListener('resize', () => {
    if (ui.view === 'month') for (const c of document.querySelectorAll('.mv-cell')) collapseOverflow(c);
  });
}

/* ------------------------------------------------------------------ */

async function main() {
  const theme = localStorage_get('kalender.theme', '');
  if (theme) document.documentElement.setAttribute('data-theme', theme);

  // Kategorien-Auswahl im Dialog aus dem Zustand aufbauen.
  await store.init();
  const catpick = $('#catpick');
  catpick.replaceChildren(...store.state.categories.map((c) => {
    const label = el('label');
    label.style.setProperty('--c', c.color);
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'cat'; input.value = c.id;
    label.append(input, el('span', 'sw'), document.createTextNode(c.name));
    return label;
  }));

  bind();
  render();

  // Jetzt-Linie minuetlich nachfuehren.
  setInterval(() => { if (ui.view !== 'month') render(); }, 60000);
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif">'
    + 'Der Kalender konnte nicht geladen werden. Details in der Browser-Konsole.</p>';
});

export { store, ui };
