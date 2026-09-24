// app.js — Controller: Zustand der Ansicht, Ereignis-Bindung, Dialoge.

import {
  ymd, hm, ymdhm, parseYmd, parseLocal, addDays, addMonths, startOfWeek,
  startOfMonth, endOfMonth, isoDow, isoWeek, minutesToHm, MONTH_NAMES,
  fmtDateLong, pad, sameDay, diffDays, startOfDay,
  parseDateInput, formatDateInput, parseTimeInput, isoWeekKey, WEEKDAY_LONG,
} from './dates.js';
import {
  Store, LocalStorageAdapter, uid, clampHeight, normalizeItem, sortItems,
} from './store.js';
import { occurrencesInRange, describeRule } from './recurrence.js';
import { toICS, parseICS } from './ics.js';
import { decodeBuffer, parseContactsFile, toBirthdayEvent } from './contacts.js';
import {
  renderMonth, renderTimeGrid, renderMiniMonth, renderTasks, renderAgenda,
  collapseOverflow, el,
} from './views.js';
import { renderTaskDay, renderTaskWeek, attachTaskInteractions } from './tasks.js';
import { renderJournal, computeField, formatHours } from './journal.js';
import {
  renderWeekPlan, renderDayPlan, attachPlanInteractions, eventItemsByDate,
} from './plan.js';

const adapter = new LocalStorageAdapter('kalender.v1');
const store = new Store(adapter);

// Reihenfolge der Reiter — auch die Reihenfolge fuer Strg+A und 1..5.
const PAGES = ['aufgaben', 'tagesplanung', 'wochenplanung', 'tagebuch', 'kalender'];

const ui = {
  page: localStorage_get('kalender.page', 'aufgaben'),
  planMode: localStorage_get('kalender.planmode', 'week'),   // 'week' | 'template'
  templateId: null,
  view: localStorage_get('kalender.view', 'week'),
  taskView: localStorage_get('kalender.taskview', 'day'),
  cursor: new Date(),
  selected: ymd(new Date()),
  miniCursor: startOfMonth(new Date()),
  scrollTop: null,
  sidebar: localStorage_get('kalender.sidebar', 'on') !== 'off',
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

/**
 * Seitenleiste ein- oder ausblenden. Danach wird neu gezeichnet, weil die
 * Monatsansicht ihre Chips an der Zellenhoehe abschneidet und die
 * Wochenspalten ihre Breite neu aufteilen muessen.
 */
function setSidebar(visible) {
  ui.sidebar = visible;
  localStorage_set('kalender.sidebar', visible ? 'on' : 'off');
  document.querySelector('.app').classList.toggle('sidebar-hidden', !visible);
  const b = $('#btn-sidebar');
  b.setAttribute('aria-pressed', String(visible));
  b.setAttribute('aria-label', visible ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden');
  render();
}

function pushUndo(label) {
  undoStack.push({ label, snapshot: JSON.stringify(store.state) });
  if (undoStack.length > 25) undoStack.shift();
}

function undo() {
  const last = undoStack.pop();
  if (!last) { toast('Nichts rückgängig zu machen.'); return; }
  const restored = JSON.parse(last.snapshot);
  // Alle Felder zuruecksetzen, nicht einzeln aufgezaehlte: bei jeder neuen
  // Datenart wurde sonst vergessen, sie hier nachzutragen — genau so ist die
  // Planung anfangs durch das Rueckgaengigmachen gefallen.
  store.mutate((s) => {
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, restored);
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

/** Welche Zeitspanne die Pfeiltasten bewegen, haengt von Seite und Ansicht ab. */
function activeSpan() {
  if (ui.page === 'kalender') return ui.view;             // month | week | day
  if (ui.page === 'aufgaben') return ui.taskView;         // day | week
  if (ui.page === 'wochenplanung') return 'week';
  return 'day';                                           // Tagesplanung, Tagebuch
}

function periodLabel() {
  const c = ui.cursor;
  const span = activeSpan();
  if (span === 'day') return fmtDateLong(c);
  if (span === 'week') {
    const s = startOfWeek(c);
    const e = addDays(s, 6);
    const sameMonth = s.getMonth() === e.getMonth();
    const left = sameMonth ? `${s.getDate()}.` : `${s.getDate()}. ${MONTH_NAMES[s.getMonth()]}`;
    return `${left} – ${e.getDate()}. ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`;
  }
  return `${MONTH_NAMES[c.getMonth()]} ${c.getFullYear()}`;
}

/* ------------------------------------------------------------------ */
/* Seitenwechsel                                                       */
/* ------------------------------------------------------------------ */

function setPage(page, { updateHash = true } = {}) {
  flushJournalPending();
  if (!PAGES.includes(page)) page = 'kalender';
  ui.page = page;
  // Auf Aufgaben- und Tagebuchseite ist der gewaehlte Tag das, was zaehlt.
  if (page !== 'kalender') ui.cursor = parseYmd(ui.selected);
  localStorage_set('kalender.page', page);
  if (updateHash && location.hash.slice(1) !== page) location.hash = page;

  for (const node of document.querySelectorAll('.page')) {
    node.hidden = node.dataset.pageid !== page;
  }
  for (const b of document.querySelectorAll('[data-page]')) {
    b.setAttribute('aria-selected', String(b.dataset.page === page));
  }
  $('#cal-views').hidden = page !== 'kalender';
  $('#task-views').hidden = page !== 'aufgaben';
  $('#btn-new').hidden = page !== 'kalender';
  $('#panel-agenda').hidden = page !== 'kalender';
  $('#panel-tasks').hidden = page !== 'kalender';
  render();
}

/* ------------------------------------------------------------------ */
/* Rendern                                                             */
/* ------------------------------------------------------------------ */

function render() {
  if (ui.page === 'aufgaben') return renderTaskPage();
  if (ui.page === 'tagesplanung') return renderDayPlanPage();
  if (ui.page === 'wochenplanung') return renderWeekPlanPage();
  if (ui.page === 'tagebuch') return renderJournalPage();
  return renderCalendarPage();
}

function renderCommonChrome() {
  const span = activeSpan();
  const kw = span === 'month' ? '' : ` <span class="kw">KW ${isoWeek(ui.cursor)}</span>`;
  $('#period').innerHTML = escapeHtml(periodLabel()) + kw;
  for (const b of document.querySelectorAll('[data-view]')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === ui.view));
  }
  for (const b of document.querySelectorAll('[data-taskview]')) {
    b.setAttribute('aria-pressed', String(b.dataset.taskview === ui.taskView));
  }
  $('#storage-warning').hidden = !adapter.degraded;
  renderSidebar();
}

function renderSidebar() {
  const miniFrom = startOfWeek(startOfMonth(ui.miniCursor));
  const miniTo = addDays(miniFrom, 42);
  const daysWithEvents = new Set();
  for (const o of occurrencesInRange(store.state.events, miniFrom, miniTo)) {
    for (let d = new Date(o.start); d <= o.end; d = addDays(d, 1)) daysWithEvents.add(ymd(d));
  }
  $('#mini').replaceChildren(renderMiniMonth({
    selected: ui.selected, daysWithEvents, today: new Date(),
  }, ui.miniCursor));

  if (ui.page !== 'kalender') return;

  const selDate = parseYmd(ui.selected);
  $('#sel-date').textContent = fmtDateLong(selDate);
  const dayOccs = occurrencesInRange(store.state.events, startOfDay(selDate), addDays(startOfDay(selDate), 1))
    .filter((o) => ymd(o.start) <= ui.selected && ui.selected <= ymd(o.end))
    .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  $('#agenda').replaceChildren(renderAgenda(dayOccs, colorOf));

  const tasks = store.tasksFor(ui.selected);
  $('#tasklist').replaceChildren(renderTasks(tasks, ui.selected));
  const open = tasks.filter((t) => !t.done).length;
  $('#task-count').textContent = tasks.length ? `${open} offen von ${tasks.length}` : '';
}

/* ---- Aufgabenseite ---- */

function renderTaskPage() {
  const root = $('#tk-root');
  const ctx = {
    dateYmd: ui.selected,
    selected: ui.selected,
    today: new Date(),
    tasksFor: (d) => store.tasksFor(d),
    days: Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(ui.cursor), i)),
  };
  root.replaceChildren(ui.taskView === 'week' ? renderTaskWeek(ctx) : renderTaskDay(ctx));
  renderCommonChrome();
}

/* ---- Planung: gemeinsame Ableitungen ---- */

const weekDayKeys = (cursor) => Array.from({ length: 7 }, (_, i) => ymd(addDays(startOfWeek(cursor), i)));
const weekDays = (cursor) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));

/** Kalendertermine der Woche als Plan-Entwuerfe, nach Tag gruppiert. */
function weekEventDrafts(cursor) {
  const from = startOfDay(startOfWeek(cursor));
  const to = addDays(from, 7);
  return eventItemsByDate(occurrencesInRange(store.state.events, from, to));
}

/** Die Vorlage, die fuer diese Woche gilt — gewaehlte oder die zum Montag jüngste. */
function templateForWeek(cursor) {
  if (ui.templateId) {
    const t = store.templateById(ui.templateId);
    if (t) return t;
    ui.templateId = null;
  }
  return store.templateFor(ymd(startOfWeek(cursor)));
}

/**
 * Was die Wochenplanung anzeigt: der eigenstaendige Wochenplan, wenn es ihn
 * gibt — sonst die Vorschau aus Vorlage und Kalender, ohne etwas anzulegen.
 */
function weekView(cursor) {
  const key = isoWeekKey(cursor);
  const plan = store.weekPlan(key);
  const keys = weekDayKeys(cursor);
  if (plan) {
    const pending = countPendingEvents(plan, weekEventDrafts(cursor));
    return { key, materialized: true, days: plan.days, templateId: plan.templateId, pending };
  }
  const tpl = templateForWeek(cursor);
  const drafts = weekEventDrafts(cursor);
  const days = {};
  keys.forEach((date, dow) => {
    days[date] = sortItems([
      ...((tpl && tpl.days[dow]) || []).map((b) => normalizeItem({ ...b, id: `vorschau-${b.id}`, source: 'template', srcId: b.id })),
      ...((drafts[date] || []).map((e) => normalizeItem({ ...e, id: `vorschau-${e.srcId}` }))),
    ]);
  });
  return { key, materialized: false, days, templateId: tpl ? tpl.id : null, pending: 0 };
}

function countPendingEvents(plan, drafts) {
  let n = 0;
  for (const [date, items] of Object.entries(drafts)) {
    const known = new Set((plan.days[date] || []).filter((x) => x.source === 'event').map((x) => x.srcId));
    for (const e of items) if (!known.has(e.srcId)) n += 1;
  }
  return n;
}

/** Legt den Wochenplan an, falls noetig, und gibt ihn zurueck. */
function materializeWeek(cursor) {
  const key = isoWeekKey(cursor);
  const existing = store.weekPlan(key);
  if (existing) return existing;
  const tpl = templateForWeek(cursor);
  const byDow = {};
  for (let i = 0; i < 7; i += 1) byDow[i] = (tpl && tpl.days[i]) || [];
  return store.ensureWeekPlan(key, weekDayKeys(cursor), byDow, weekEventDrafts(cursor), tpl ? tpl.id : null);
}

/* ---- Wochenplanung ---- */

function renderWeekPlanPage() {
  const view = weekView(ui.cursor);
  const tplId = ui.planMode === 'template'
    ? (ui.templateId || (store.templatesSorted()[0] || {}).id || null)
    : view.templateId;
  const tpl = tplId ? store.templateById(tplId) : null;

  $('#wp-root').replaceChildren(renderWeekPlan({
    mode: ui.planMode,
    days: weekDays(ui.cursor),
    dayKeys: weekDayKeys(ui.cursor),
    itemsFor: (key) => (ui.planMode === 'template'
      ? ((tpl && tpl.days[Number(key)]) || [])
      : (view.days[key] || [])),
    materialized: view.materialized,
    templates: store.templatesSorted(),
    activeTemplateId: tplId,
    pendingEvents: view.pending,
    today: new Date(),
    selected: ui.selected,
    colorOf,
  }));
  renderCommonChrome();
}

/* ---- Tagesplanung ---- */

/** Die Eintraege des Tages: eigener Tagesplan, sonst der Tag aus der Woche. */
function dayPlanView(dateYmd) {
  const own = store.dayPlan(dateYmd);
  if (own) return { detached: true, items: own.items };
  const view = weekView(parseYmd(dateYmd));
  return { detached: false, items: view.days[dateYmd] || [] };
}

function renderDayPlanPage() {
  const v = dayPlanView(ui.selected);
  $('#tp-root').replaceChildren(renderDayPlan({
    dateYmd: ui.selected,
    items: v.items,
    detached: v.detached,
    today: new Date(),
    colorOf,
  }));
  renderCommonChrome();
}

/**
 * Jede Aenderung auf der Tagesplanung geht durch diesen Trichter: er legt
 * den eigenstaendigen Tagesplan an, falls es ihn noch nicht gibt, und
 * uebergibt dann dessen Eintragsliste zur Bearbeitung.
 */
function mutateDayPlan(fn, label) {
  pushUndo(label);
  const existing = store.dayPlan(ui.selected);
  if (!existing) {
    const v = dayPlanView(ui.selected);
    store.ensureDayPlan(ui.selected, v.items);
  }
  store.mutate((s) => { fn(s.dayPlans[ui.selected]); });
  render();
}

/** Dasselbe fuer die Wochenplanung: erst anlegen, dann aendern. */
function mutateWeekPlan(fn, label) {
  pushUndo(label);
  const plan = materializeWeek(ui.cursor);
  void plan;
  const key = isoWeekKey(ui.cursor);
  store.mutate((s) => { fn(s.weekPlans[key]); });
  render();
}

/** Und fuer die Vorlage — dort erzeugt eine Aenderung ggf. eine neue Fassung. */
function mutateTemplate(fn, label) {
  const today = ymd(new Date());
  let id = ui.templateId || (store.templatesSorted()[0] || {}).id;
  if (!id) {
    pushUndo('Vorlage angelegt');
    id = store.createTemplate('Wochenvorlage', today).id;
  } else {
    pushUndo(label);
  }
  const effective = store.editTemplate(id, today, fn);
  if (effective !== id) toast('Neue Fassung der Vorlage angelegt.');
  ui.templateId = effective;
  render();
}

/* ---- Tagebuchseite ---- */

function renderJournalPage() {
  const root = $('#jr-root');
  const date = ui.selected;
  const d = parseYmd(date);
  const entry = store.journalFor(date);
  const occs = occurrencesInRange(store.state.events, startOfDay(d), addDays(startOfDay(d), 1))
    .filter((o) => ymd(o.start) <= date && date <= ymd(o.end))
    .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  const tasks = store.tasksFor(date);
  root.replaceChildren(renderJournal({
    dateYmd: date,
    schema: store.state.journalSchema,
    values: entry.values,
    entry: entry.entry,
    occurrences: occs,
    doneTasks: tasks.filter((t) => t.done),
    openTasks: tasks.filter((t) => !t.done),
    colorOf,
  }));
  renderCommonChrome();
}

/* ---- Kalenderseite ---- */

function renderCalendarPage() {
  const days = visibleDays();
  const from = startOfDay(days[0]);
  const to = addDays(startOfDay(days[days.length - 1]), 1);
  const occurrences = occurrencesInRange(store.state.events, from, to);

  const tasksByDate = new Map();
  for (const t of store.state.tasks) {
    if (!tasksByDate.has(t.date)) tasksByDate.set(t.date, []);
    tasksByDate.get(t.date).push(t);
  }

  const ctx = {
    cursor: ui.cursor,
    selected: ui.selected,
    occurrences,
    colorOf,
    tasksByDate,
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

  renderCommonChrome();
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
  flushJournalPending();
  const span = activeSpan();
  if (span === 'month') ui.cursor = addMonths(ui.cursor, dir);
  else if (span === 'week') ui.cursor = addDays(ui.cursor, 7 * dir);
  else ui.cursor = addDays(ui.cursor, dir);
  ui.miniCursor = startOfMonth(ui.cursor);
  if (span === 'day') ui.selected = ymd(ui.cursor);
  else if (ui.page !== 'kalender') {
    // In der Wochenansicht der Aufgabenseite mitwandern, damit der
    // gewaehlte Tag in der sichtbaren Woche bleibt.
    const s = startOfWeek(ui.cursor);
    if (parseYmd(ui.selected) < s || parseYmd(ui.selected) > addDays(s, 6)) ui.selected = ymd(s);
  }
  render();
}

function goToday() {
  flushJournalPending();
  ui.cursor = new Date();
  ui.selected = ymd(ui.cursor);
  ui.miniCursor = startOfMonth(ui.cursor);
  ui.scrollTop = null;
  render();
}

function selectDate(key, { focusView = false } = {}) {
  flushJournalPending();
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
  $('#f-date').value = formatDateInput(startD);
  $('#f-enddate').value = formatDateInput(endD);
  $('#f-from').value = init.allDay ? '09:00' : (String(init.start).slice(11, 16) || '09:00');
  $('#f-to').value = init.allDay ? '10:00' : (String(init.end).slice(11, 16) || '10:00');
  for (const id of ['#f-date', '#f-enddate', '#f-from', '#f-to', '#f-until']) markInvalid($(id), false);
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
  else if (r && r.until) { $('#f-endmode').value = 'until'; $('#f-until').value = formatDateInput(r.until); $('#f-count').value = 10; }
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

/* ---- Tastatureingabe in Datums- und Zeitfeldern ---- */

function markInvalid(elm, bad) {
  if (!elm) return;
  elm.classList.toggle('invalid', !!bad);
  if (bad) elm.setAttribute('aria-invalid', 'true');
  else elm.removeAttribute('aria-invalid');
}

function fail(sel) {
  const elm = $(sel);
  markInvalid(elm, true);
  elm.focus();
  elm.select?.();
  toast('Eingabe nicht lesbar — siehe Hinweis unter den Feldern.');
  return null;
}

/** Beim Verlassen auf die kanonische Schreibweise bringen. */
function normalizeField(elm, kind) {
  const raw = elm.value.trim();
  if (!raw) { markInvalid(elm, false); return; }
  const parsed = kind === 'date' ? parseDateInput(raw) : parseTimeInput(raw);
  if (parsed) {
    elm.value = kind === 'date' ? formatDateInput(parsed) : parsed;
    markInvalid(elm, false);
  } else {
    markInvalid(elm, true);
  }
}

function attachFieldNormalizers() {
  const fields = [['#f-date', 'date'], ['#f-enddate', 'date'], ['#f-until', 'date'],
    ['#f-from', 'time'], ['#f-to', 'time']];
  for (const [sel, kind] of fields) {
    const elm = $(sel);
    elm.addEventListener('blur', () => normalizeField(elm, kind));
    elm.addEventListener('input', () => markInvalid(elm, false));
  }
}

/**
 * Liest die Eingabefelder. Gibt null zurueck und markiert das erste
 * unlesbare Feld, statt stillschweigend einen Ersatzwert einzusetzen.
 */
function readDialog() {
  const allDay = $('#f-allday').checked;

  const d = parseDateInput($('#f-date').value);
  if (!d) return fail('#f-date');

  let endDay = d;
  if (allDay && $('#f-enddate').value.trim()) {
    endDay = parseDateInput($('#f-enddate').value);
    if (!endDay) return fail('#f-enddate');
  }

  let from = '09:00';
  let toT = '10:00';
  if (!allDay) {
    from = parseTimeInput($('#f-from').value || '09:00');
    if (!from) return fail('#f-from');
    toT = parseTimeInput($('#f-to').value || from);
    if (!toT) return fail('#f-to');
  }

  let start; let end;
  if (allDay) {
    start = d;
    end = endDay < d ? d : endDay;
  } else {
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
    let until = null;
    if (mode === 'until') {
      until = parseDateInput($('#f-until').value);
      if (!until) return fail('#f-until');
    }
    rrule = {
      freq,
      interval: Math.max(1, parseInt($('#f-interval').value, 10) || 1),
      byDay: byDay && byDay.length ? byDay : null,
      count: mode === 'count' ? Math.max(1, parseInt($('#f-count').value, 10) || 1) : null,
      until,
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
    const src = store.state.events.find((e) => e.id === editing.id);
    store.excludeOccurrence(editing.id, editing.occDate);
    store.addEvent({ ...data, id: uid(), rrule: null, exdates: [], birthYear: src?.birthYear ?? null });
  } else {
    pushUndo('Termin geändert');
    const existing = store.state.events.find((e) => e.id === editing.id);
    const patch = { ...data };
    if (editing.isSeries) patch.exdates = existing ? existing.exdates : [];
    // readDialog() kennt leapFallback nicht — sonst ginge die Schaltjahr-
    // Behandlung eines Geburtstags beim ersten Bearbeiten verloren.
    if (existing?.rrule?.leapFallback && patch.rrule?.freq === 'YEARLY') {
      patch.rrule = { ...patch.rrule, leapFallback: true };
    }
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
      const { events, tasks, skipped, cancelled, overrides } = parseICS(text, store.state.categories);
      let added = 0;
      store.mutate((s) => {
        if (mode === 'replace') { s.events = []; s.tasks = []; }
        // Das Set muss mitwachsen, sonst landen zwei Einträge mit derselben
        // ID aus EINER Datei beide im Zustand.
        const known = new Set(s.events.map((e) => e.id));
        for (const e of events) {
          if (known.has(e.id)) continue;
          known.add(e.id);
          s.events.push(e);
          added += 1;
        }
        const kt = new Set(s.tasks.map((t) => t.id));
        for (const t of tasks) {
          if (kt.has(t.id)) continue;
          kt.add(t.id);
          s.tasks.push(t);
        }
      });
      const notes = [];
      if (skipped) notes.push(`${skipped} übersprungen`);
      if (cancelled) notes.push(`${cancelled} abgesagt`);
      if (overrides) notes.push(`${overrides} Serien-Ausnahmen`);
      toast(`${added} Termine, ${tasks.length} Aufgaben importiert`
        + (notes.length ? ` (${notes.join(', ')}).` : '.'));
    }
  } catch (err) {
    console.error(err);
    toast('Datei konnte nicht gelesen werden.');
    undoStack.pop();
  }
  render();
}

/* ------------------------------------------------------------------ */
/* Hilfen fuer Plan-Listen                                             */
/* ------------------------------------------------------------------ */

/** Wendet `fn` auf jede Tagesliste eines Plans oder einer Vorlage an. */
function forEachList(days, fn) {
  for (const k of Object.keys(days)) fn(days[k]);
}

/** Verschiebt einen Eintrag innerhalb von `days` an Position `index` von `targetKey`. */
function moveItemBetween(days, id, targetKey, index) {
  let moved = null;
  for (const k of Object.keys(days)) {
    const i = days[k].findIndex((x) => x.id === id);
    if (i >= 0) { [moved] = days[k].splice(i, 1); break; }
  }
  if (!moved) return;
  if (!days[targetKey]) days[targetKey] = [];
  days[targetKey].splice(Math.max(0, Math.min(index, days[targetKey].length)), 0, moved);
}

/* ------------------------------------------------------------------ */
/* Tagebuch: entprelltes Schreiben                                     */
/* ------------------------------------------------------------------ */
//
// Waehrend des Tippens darf nicht neu gezeichnet werden, sonst verliert das
// Feld den Fokus. Deshalb: Wert entprellt in den Zustand schreiben, und nur
// bei einem Feld, das in eine Summe eingeht, danach die Summen auffrischen.

let jTimer = null;
let jPending = null;

function readFieldValue(input) {
  const id = input.dataset.jfield;
  const part = input.dataset.jpart;
  const field = store.state.journalSchema.find((f) => f.id === id);
  if (!field) return null;

  if (field.type === 'numtext') {
    const row = input.closest('[data-jrow]');
    const n = row.querySelector('[data-jpart="n"]').value.trim();
    const text = row.querySelector('[data-jpart="text"]').value.trim();
    if (!n && !text) return { id, value: null };
    return { id, value: { n: n === '' ? null : Number(n), text } };
  }
  if (field.type === 'number') {
    const v = input.value.trim();
    return { id, value: v === '' ? null : Number(v) };
  }
  void part;
  return { id, value: input.value.trim() };
}

function scheduleJournalWrite(input) {
  // Das Datum wird beim Tippen festgehalten, nicht beim Schreiben: sonst
  // landete eine noch offene Eingabe im falschen Tag, wenn man inzwischen
  // weiterblaettert.
  const date = ui.selected;
  jPending = { input, date };
  clearTimeout(jTimer);
  jTimer = setTimeout(() => flushJournalWrite(input, false, date), 400);
}

/** `refresh` zeichnet die abgeleiteten Summen neu (beim Verlassen des Feldes). */
function flushJournalWrite(input, refresh, date = ui.selected) {
  clearTimeout(jTimer);
  jPending = null;
  const r = readFieldValue(input);
  if (!r) return;
  store.setJournalValue(date, r.id, r.value);
  if (refresh && date === ui.selected) refreshComputed();
}

/** Offene Eingaben festschreiben, bevor der gewaehlte Tag wechselt. */
function flushJournalPending() {
  if (jPending) flushJournalWrite(jPending.input, false, jPending.date);
  if (entryPending) {
    clearTimeout(entryTimer);
    store.setJournalEntry(entryPending.date, entryPending.ta.value);
    entryPending = null;
  }
}

/** Nur die Summenkacheln neu schreiben — ohne die Eingabefelder anzufassen. */
function refreshComputed() {
  const values = store.journalFor(ui.selected).values;
  const strip = $('#jr-root').querySelector('.jr-strip');
  if (!strip) return;
  const schema = store.state.journalSchema;
  const computed = schema.filter((f) => f.type === 'computed');
  const cards = [...strip.querySelectorAll('.jr-stat')];
  // Die Schlafzeit-Kachel steht ggf. davor; von hinten zuordnen.
  const offset = cards.length - computed.length;
  computed.forEach((f, i) => {
    const card = cards[offset + i];
    if (card) card.querySelector('.v').textContent = formatHours(computeField(f, values));
  });
}

let entryTimer = null;
let entryPending = null;
function scheduleEntryWrite(ta) {
  const date = ui.selected;
  entryPending = { ta, date };
  clearTimeout(entryTimer);
  entryTimer = setTimeout(() => {
    store.setJournalEntry(date, ta.value);
    entryPending = null;
  }, 500);
}

/* ------------------------------------------------------------------ */
/* Kategorien                                                          */
/* ------------------------------------------------------------------ */

/** Die Auswahlknoepfe im Termin-Dialog aus dem Zustand neu aufbauen. */
function buildCatPick() {
  const keep = document.querySelector('input[name="cat"]:checked')?.value;
  $('#catpick').replaceChildren(...store.state.categories.map((c) => {
    const label = el('label');
    label.style.setProperty('--c', c.color);
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'cat'; input.value = c.id;
    if (c.id === keep) input.checked = true;
    label.append(input, el('span', 'sw'), document.createTextNode(c.name));
    return label;
  }));
}

function categoryUsage() {
  const counts = new Map();
  for (const e of store.state.events) counts.set(e.category, (counts.get(e.category) || 0) + 1);
  return counts;
}

function renderCategoryEditor() {
  const counts = categoryUsage();
  const list = $('#cat-list');
  list.replaceChildren(...store.state.categories.map((c) => {
    const row = el('div', 'cat-row');

    const color = document.createElement('input');
    color.type = 'color';
    color.value = c.color;
    color.dataset.catcolor = c.id;
    color.setAttribute('aria-label', `Farbe für ${c.name}`);

    const name = document.createElement('input');
    name.type = 'text';
    name.value = c.name;
    name.dataset.catname = c.id;
    name.autocomplete = 'off';
    name.setAttribute('aria-label', 'Name der Kategorie');

    const n = counts.get(c.id) || 0;
    const use = el('span', 'use', n === 1 ? '1 Termin' : `${n} Termine`);

    const rm = el('button', 'rm', '×');
    rm.type = 'button';
    rm.dataset.catdel = c.id;
    rm.setAttribute('aria-label', `Kategorie ${c.name} löschen`);
    // "sonstiges" ist das Auffangbecken beim Loeschen und muss bleiben.
    if (c.id === 'sonstiges') { rm.disabled = true; rm.title = 'Auffangkategorie, nicht löschbar'; }

    row.append(color, name, use, rm);
    return row;
  }));
}

function afterCategoryChange() {
  renderCategoryEditor();
  buildCatPick();
  render();
}

/* ------------------------------------------------------------------ */
/* Geburtstage aus Kontakten                                           */
/* ------------------------------------------------------------------ */

let pendingBirthdays = null;

const MONTH_SHORT_DE = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

async function loadContactsFile(file) {
  const text = decodeBuffer(await file.arrayBuffer());
  const { entries, diagnostics, kind } = parseContactsFile(text, file.name);

  const existing = new Set(store.state.events.map((e) => e.id));
  const good = [];
  const bad = [];
  let duplicates = 0;

  for (const e of entries) {
    if (!e.ok) { bad.push(e); continue; }
    const ev = toBirthdayEvent(e);
    if (existing.has(ev.id)) { duplicates += 1; continue; }
    good.push({ entry: e, event: ev });
  }

  pendingBirthdays = good;
  renderBirthdayPreview({ good, bad, duplicates, diagnostics, kind, total: entries.length });
  $('#birthday-dialog').showModal();
}

function renderBirthdayPreview({ good, bad, duplicates, diagnostics, kind, total }) {
  const withoutYear = good.filter((g) => g.entry.y == null).length;
  const parts = [`${good.length} Geburtstage werden angelegt`];
  if (withoutYear) parts.push(`${withoutYear} davon ohne Jahrgang (kein Alter)`);
  if (duplicates) parts.push(`${duplicates} bereits vorhanden, übersprungen`);
  if (bad.length) parts.push(`${bad.length} nicht lesbar`);
  $('#bd-summary').textContent = `${parts.join(' · ')} — gelesen als ${kind === 'vcard' ? 'vCard' : 'CSV'}, ${total} Einträge mit Datum.`;

  const problems = $('#bd-problems');
  problems.replaceChildren();
  for (const d of diagnostics || []) problems.append(el('div', 'bd-note', d));
  if (bad.length) {
    const ambiguous = bad.filter((b) => b.ambiguous).length;
    problems.append(el('div', 'bd-note',
      ambiguous
        ? `${ambiguous} Datumsangaben sind mehrdeutig (z. B. 03/04/2001 — Tag oder Monat zuerst?). Sie werden nicht übernommen; im Zweifel in den Kontakten auf ein eindeutiges Format ändern.`
        : `${bad.length} Datumsangaben konnten nicht gelesen werden und werden übersprungen.`));
  }

  const list = $('#bd-list');
  list.replaceChildren();
  const rows = [
    ...good.map((g) => ({ ...g.entry, ok: true })),
    ...bad.map((b) => ({ ...b, ok: false })),
  ];
  if (!rows.length) {
    list.append(el('div', 'empty', 'Keine Geburtstage in der Datei gefunden.'));
  }
  for (const r of rows) {
    const row = el('div', r.ok ? 'bd-row' : 'bd-row bad');
    row.append(el('span', 'n', r.name));
    row.append(el('span', 'd', r.ok
      ? `${String(r.d).padStart(2, '0')}. ${MONTH_SHORT_DE[r.m - 1]}${r.y ? ` ${r.y}` : ''}`
      : String(r.raw)));
    row.append(el('span', 'a', r.ok
      ? (r.y ? `${new Date().getFullYear() - r.y} Jahre` : 'ohne Jahr')
      : (r.ambiguous ? 'mehrdeutig' : 'unlesbar')));
    list.append(row);
  }

  $('#bd-confirm').disabled = good.length === 0;
  $('#bd-confirm').textContent = good.length ? `${good.length} übernehmen` : 'Nichts zu übernehmen';
}

function confirmBirthdays() {
  if (!pendingBirthdays || !pendingBirthdays.length) { $('#birthday-dialog').close(); return; }
  pushUndo('Geburtstage importiert');
  const n = pendingBirthdays.length;
  store.mutate((s) => {
    for (const { event } of pendingBirthdays) s.events.push(event);
  });
  pendingBirthdays = null;
  $('#birthday-dialog').close();
  $('#menu-dialog').close();
  toast(`${n} Geburtstage übernommen — rückgängig mit Strg+Z.`);
  render();
}

/* ------------------------------------------------------------------ */
/* Bindung                                                             */
/* ------------------------------------------------------------------ */

function bind() {
  /* Seitenreiter und Hash-Routing */
  for (const b of document.querySelectorAll('[data-page]')) {
    b.addEventListener('click', () => setPage(b.dataset.page));
  }
  window.addEventListener('hashchange', () => setPage(location.hash.slice(1), { updateHash: false }));

  for (const b of document.querySelectorAll('[data-taskview]')) {
    b.addEventListener('click', () => {
      ui.taskView = b.dataset.taskview;
      localStorage_set('kalender.taskview', ui.taskView);
      render();
    });
  }

  /* ---- Aufgabenseite ---- */
  const tkRoot = $('#tk-root');

  attachTaskInteractions(tkRoot, {
    onReorder: (id, targetDate, index) => {
      pushUndo('Aufgabe verschoben');
      store.moveTask(id, targetDate, index);
      render();
    },
    onResize: (id, height) => {
      pushUndo('Aufgabenhöhe geändert');
      store.updateTask(id, { height: clampHeight(height) });
    },
  });

  tkRoot.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-tktoggle]');
    if (cb) {
      pushUndo('Aufgabe umgeschaltet');
      store.updateTask(cb.dataset.tktoggle, { done: cb.checked });
      render();
      return;
    }
    const title = e.target.closest('[data-tktitle]');
    if (title) {
      const text = title.value.trim();
      if (!text) { render(); return; }      // leerer Titel wird verworfen
      pushUndo('Aufgabe umbenannt');
      store.updateTask(title.dataset.tktitle, { title: text });
    }
  });

  tkRoot.addEventListener('click', (e) => {
    const del = e.target.closest('[data-tkdel]');
    if (del) {
      pushUndo('Aufgabe gelöscht');
      store.deleteTask(del.dataset.tkdel);
      render();
      return;
    }
    const goto = e.target.closest('[data-gotoday]');
    if (goto) {
      ui.selected = goto.dataset.gotoday;
      ui.cursor = parseYmd(ui.selected);
      ui.taskView = 'day';
      localStorage_set('kalender.taskview', 'day');
      render();
    }
  });

  tkRoot.addEventListener('submit', (e) => {
    const form = e.target.closest('.tk-add');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('[data-tkadd]');
    const text = input.value.trim();
    if (!text) return;
    pushUndo('Aufgabe angelegt');
    store.addTask(form.dataset.date, text);
    input.value = '';
    render();
    // Nach dem Neuzeichnen ist das Feld ein anderes: erneut suchen.
    const again = tkRoot.querySelector(`[data-tkadd="${CSS.escape(form.dataset.date)}"]`);
    if (again) again.focus();
  });

  /* ---- Planungsseiten ---- */
  for (const root of [$('#wp-root'), $('#tp-root')]) {
    const isWeek = root.id === 'wp-root';

    attachPlanInteractions(root, {
      onReorder: (id, targetKey, index) => {
        if (isWeek && ui.planMode === 'template') {
          mutateTemplate((t) => moveItemBetween(t.days, id, Number(targetKey), index), 'Vorlage umsortiert');
        } else if (isWeek) {
          mutateWeekPlan((p) => moveItemBetween(p.days, id, targetKey, index), 'Plan umsortiert');
        } else {
          mutateDayPlan((p) => {
            const i = p.items.findIndex((x) => x.id === id);
            if (i < 0) return;
            const [it] = p.items.splice(i, 1);
            p.items.splice(Math.max(0, Math.min(index, p.items.length)), 0, it);
          }, 'Plan umsortiert');
        }
      },
    });

    root.addEventListener('change', (e) => {
      const f = e.target.closest('[data-plitem]');
      if (!f) return;
      const { plitem: id, plpart: part } = f.dataset;
      let value = f.value.trim();
      if (part === 'start' || part === 'end') {
        if (value) {
          const parsed = parseTimeInput(value);
          if (!parsed) { f.classList.add('invalid'); toast('Uhrzeit nicht lesbar.'); return; }
          value = parsed;
        } else value = null;
      }
      f.classList.remove('invalid');
      const apply = (list) => {
        const it = list.find((x) => x.id === id);
        if (it) it[part] = value;
      };
      if (isWeek && ui.planMode === 'template') mutateTemplate((t) => forEachList(t.days, apply), 'Vorlage geändert');
      else if (isWeek) mutateWeekPlan((p) => forEachList(p.days, apply), 'Plan geändert');
      else mutateDayPlan((p) => apply(p.items), 'Plan geändert');
    });

    root.addEventListener('click', (e) => {
      const del = e.target.closest('[data-pldel]');
      if (del) {
        const id = del.dataset.pldel;
        const drop = (list) => {
          const i = list.findIndex((x) => x.id === id);
          if (i >= 0) list.splice(i, 1);
        };
        if (isWeek && ui.planMode === 'template') mutateTemplate((t) => forEachList(t.days, drop), 'Eintrag entfernt');
        else if (isWeek) mutateWeekPlan((p) => forEachList(p.days, drop), 'Eintrag entfernt');
        else mutateDayPlan((p) => drop(p.items), 'Eintrag entfernt');
        return;
      }
      const goto = e.target.closest('[data-plgoto]');
      if (goto) { ui.selected = goto.dataset.plgoto; setPage('tagesplanung'); return; }
      if (!isWeek) {
        if (e.target.closest('[data-plresetday]')) {
          pushUndo('Tagesplan verworfen');
          store.deleteDayPlan(ui.selected);
          toast('Tag kommt wieder aus dem Wochenplan.');
          render();
        }
        return;
      }
      const mode = e.target.closest('[data-plmode]');
      if (mode) {
        ui.planMode = mode.dataset.plmode;
        localStorage_set('kalender.planmode', ui.planMode);
        render();
        return;
      }
      if (e.target.closest('[data-plnewtemplate]')) {
        pushUndo('Vorlage angelegt');
        const t = store.createTemplate(`Wochenvorlage ${store.state.planTemplates.length + 1}`, ymd(new Date()));
        ui.templateId = t.id;
        ui.planMode = 'template';
        localStorage_set('kalender.planmode', 'template');
        render();
        return;
      }
      if (e.target.closest('[data-pldeltemplate]')) {
        const id = ui.templateId || (store.templatesSorted()[0] || {}).id;
        if (!id) return;
        pushUndo('Vorlage gelöscht');
        store.deleteTemplate(id);
        ui.templateId = (store.templatesSorted()[0] || {}).id || null;
        toast('Vorlage gelöscht.');
        render();
        return;
      }
      if (e.target.closest('[data-plsync]')) {
        pushUndo('Kalender übernommen');
        const n = store.syncWeekEvents(isoWeekKey(ui.cursor), weekEventDrafts(ui.cursor));
        toast(n ? (n === 1 ? '1 Termin übernommen.' : `${n} Termine übernommen.`) : 'Nichts Neues im Kalender.');
        render();
        return;
      }
      if (e.target.closest('[data-plresetweek]')) {
        pushUndo('Wochenplan verworfen');
        store.deleteWeekPlan(isoWeekKey(ui.cursor));
        toast('Woche kommt wieder aus Vorlage und Kalender.');
        render();
      }
    });

    root.addEventListener('submit', (e) => {
      const form = e.target.closest('.pl-add');
      if (!form) return;
      e.preventDefault();
      const input = form.querySelector('[data-pladd]');
      const title = input.value.trim();
      if (!title) return;
      const key = form.dataset.plkey;
      const draft = { title, source: 'own' };
      if (isWeek && ui.planMode === 'template') {
        mutateTemplate((t) => { t.days[Number(key)].push(normalizeItem(draft)); }, 'Eintrag angelegt');
      } else if (isWeek) {
        mutateWeekPlan((p) => { (p.days[key] ||= []).push(normalizeItem(draft)); }, 'Eintrag angelegt');
      } else {
        mutateDayPlan((p) => { p.items.push(normalizeItem(draft)); }, 'Eintrag angelegt');
      }
      const again = root.querySelector(`[data-pladd="${CSS.escape(key)}"]`);
      if (again) again.focus();
    });

    if (isWeek) {
      root.addEventListener('change', (e) => {
        if (e.target.id !== 'pl-template') return;
        ui.templateId = e.target.value || null;
        if (ui.planMode === 'week') {
          // In einer bereits angelegten Woche waehlt man die Vorlage nicht
          // mehr um — die Woche ist eine Kopie und bleibt es.
          const plan = store.weekPlan(isoWeekKey(ui.cursor));
          if (plan) toast('Diese Woche ist bereits angelegt — erst zurücksetzen.');
        }
        render();
      });
    }
  }

  /* ---- Tagebuchseite ---- */
  const jrRoot = $('#jr-root');

  jrRoot.addEventListener('click', (e) => {
    const dot = e.target.closest('[data-jvalue]');
    if (dot) {
      const id = dot.dataset.jfield;
      const val = Number(dot.dataset.jvalue);
      const cur = store.journalFor(ui.selected).values[id];
      pushUndo('Tagebuchwert geändert');
      // Nochmal auf denselben Wert tippen loescht ihn wieder.
      store.setJournalValue(ui.selected, id, cur === val ? null : val);
      render();
      return;
    }
    const bool = e.target.closest('[data-jtoggle]');
    if (bool) {
      const id = bool.dataset.jfield;
      const cur = store.journalFor(ui.selected).values[id];
      // Dreistufig: nicht gesetzt -> ja -> nein -> nicht gesetzt.
      const next = cur === true ? false : (cur === false ? null : true);
      pushUndo('Tagebuchwert geändert');
      store.setJournalValue(ui.selected, id, next);
      render();
    }
  });

  jrRoot.addEventListener('input', (e) => {
    const field = e.target.closest('[data-jfield]');
    if (field && field.dataset.jpart) { scheduleJournalWrite(field); return; }
    if (e.target.id === 'jr-entry-text') scheduleEntryWrite(e.target);
  });
  jrRoot.addEventListener('change', (e) => {
    const field = e.target.closest('[data-jfield]');
    if (field && field.dataset.jpart) flushJournalWrite(field, true);
  });

  $('#btn-today').addEventListener('click', goToday);
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }
  $('#btn-new').addEventListener('click', () => newEventAt(ui.selected, null));
  $('#btn-menu').addEventListener('click', () => $('#menu-dialog').showModal());
  $('#btn-sidebar').addEventListener('click', () => setSidebar(!ui.sidebar));

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
  attachFieldNormalizers();

  $('#btn-categories').addEventListener('click', () => {
    renderCategoryEditor();
    $('#category-dialog').showModal();
  });
  $('#cat-close').addEventListener('click', () => $('#category-dialog').close());
  $('#cat-add').addEventListener('click', () => {
    pushUndo('Kategorie angelegt');
    store.mutate((st) => {
      st.categories.push({ id: `cat-${uid().slice(0, 8)}`, name: 'Neue Kategorie', color: '#64748b' });
    });
    afterCategoryChange();
    const rows = $('#cat-list').querySelectorAll('[data-catname]');
    const last = rows[rows.length - 1];
    if (last) { last.focus(); last.select(); }
  });
  // 'change' statt 'input': sonst landet jeder Tastendruck im Undo-Stapel.
  $('#cat-list').addEventListener('change', (e) => {
    const nameEl = e.target.closest('[data-catname]');
    const colorEl = e.target.closest('[data-catcolor]');
    if (!nameEl && !colorEl) return;
    pushUndo('Kategorie geändert');
    store.mutate((st) => {
      const id = (nameEl || colorEl).dataset.catname || colorEl.dataset.catcolor;
      const c = st.categories.find((x) => x.id === id);
      if (!c) return;
      if (nameEl) c.name = nameEl.value.trim() || c.name;
      if (colorEl) c.color = colorEl.value;
    });
    buildCatPick();
    render();
  });
  $('#cat-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-catdel]');
    if (!del || del.disabled) return;
    const id = del.dataset.catdel;
    const moved = categoryUsage().get(id) || 0;
    pushUndo('Kategorie gelöscht');
    store.mutate((st) => {
      st.categories = st.categories.filter((c) => c.id !== id);
      for (const ev of st.events) if (ev.category === id) ev.category = 'sonstiges';
      if (st.settings.defaultCategory === id) st.settings.defaultCategory = 'sonstiges';
    });
    afterCategoryChange();
    toast(moved
      ? `Kategorie gelöscht, ${moved} Termine nach „Sonstiges“ verschoben.`
      : 'Kategorie gelöscht.');
  });

  $('#btn-contacts').addEventListener('click', () => $('#contacts-input').click());
  $('#contacts-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await loadContactsFile(file);
    } catch (err) {
      console.error(err);
      toast('Kontakt-Datei konnte nicht gelesen werden.');
    }
  });
  $('#bd-confirm').addEventListener('click', confirmBirthdays);
  $('#bd-cancel').addEventListener('click', () => {
    pendingBirthdays = null;
    $('#birthday-dialog').close();
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

    // Strg+A blaettert durch die Reiter. In einem Textfeld bleibt es
    // "alles markieren" — dort waere das Ueberschreiben der gewohnten
    // Bedeutung schlicht laestig.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
      e.preventDefault();
      const i = PAGES.indexOf(ui.page);
      const next = (i + (e.shiftKey ? -1 : 1) + PAGES.length) % PAGES.length;
      setPage(PAGES[next]);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); render(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    switch (e.key) {
      case '1': case '2': case '3': case '4': case '5':
        setPage(PAGES[Number(e.key) - 1]);
        break;
      case 'ArrowLeft': step(-1); break;
      case 'ArrowRight': step(1); break;
      case 'm': case 'M': if (ui.page === 'kalender') setView('month'); break;
      case 'w': case 'W':
        if (ui.page === 'kalender') setView('week');
        else if (ui.page === 'aufgaben') { ui.taskView = 'week'; localStorage_set('kalender.taskview', 'week'); render(); }
        break;
      case 'v': case 'V':
        if (ui.page === 'wochenplanung') {
          ui.planMode = ui.planMode === 'template' ? 'week' : 'template';
          localStorage_set('kalender.planmode', ui.planMode);
          render();
        }
        break;
      case 'd': case 'D':
        if (ui.page === 'kalender') setView('day');
        else if (ui.page === 'aufgaben') { ui.taskView = 'day'; localStorage_set('kalender.taskview', 'day'); render(); }
        break;
      case 's': case 'S': setSidebar(!ui.sidebar); break;
      case 't': case 'T': case 'h': case 'H': goToday(); break;
      case 'n': case 'N':
        if (ui.page !== 'kalender') return;
        e.preventDefault(); newEventAt(ui.selected, null);
        break;
      default: return;
    }
  });

  window.addEventListener('beforeunload', () => { flushJournalPending(); store.flush(); });
  window.addEventListener('resize', () => {
    if (ui.view === 'month') for (const c of document.querySelectorAll('.mv-cell')) collapseOverflow(c);
  });
}

/* ------------------------------------------------------------------ */

async function main() {
  const theme = localStorage_get('kalender.theme', '');
  if (theme) document.documentElement.setAttribute('data-theme', theme);

  await store.init();
  buildCatPick();

  bind();
  setSidebar(ui.sidebar);
  setPage(location.hash.slice(1) || ui.page, { updateHash: false });

  // Jetzt-Linie minuetlich nachfuehren.
  setInterval(() => { if (ui.view !== 'month') render(); }, 60000);
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif">'
    + 'Der Kalender konnte nicht geladen werden. Details in der Browser-Konsole.</p>';
});

export { store, ui };
