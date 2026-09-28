// model.js — Datenmodell und Fortschrittsrechnung. Reine Funktionen, kein DOM.
//
//   Projekt ─┬─ Meilenstein ─┬─ Aufgabe (Gewicht w, erledigt am …)
//            │               └─ Aufgabe …
//            └─ Meilenstein (ohne Aufgaben: zählt selbst als eine Einheit)
//
// Ist-Fortschritt  = erledigtes Gewicht / Gesamtgewicht.
// Soll-Fortschritt = stückweise linear: zwischen dem Fälligkeitsdatum des
//   vorigen Meilensteins (bzw. dem Projektbeginn) und dem eigenen wächst der
//   Soll-Wert um das Gewicht dieses Meilensteins. Meilensteine ohne eigenes
//   Datum erben das Projektende. Ohne Beginn oder ohne erreichbares Datum
//   ist kein Soll definiert — dann wird auch keines angezeigt, statt eines
//   erfundenen.
//
// Alle Datumsangaben sind lokale Kalendertage 'YYYY-MM-DD' (Wanduhrzeit,
// wie im Kalender), gerechnet wird in ganzen Tagen.

export const SCHEMA = 1;

export const STATUS = [
  { id: 'geplant', label: 'Geplant' },
  { id: 'aktiv', label: 'Aktiv' },
  { id: 'pausiert', label: 'Pausiert' },
  { id: 'abgeschlossen', label: 'Abgeschlossen' },
  { id: 'verworfen', label: 'Verworfen' },
];
export const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.id, s.label]));

export const COLORS = [
  '#0ea5a4', '#2563eb', '#7c3aed', '#db2777',
  '#ea580c', '#ca8a04', '#16a34a', '#64748b',
];

export const WEIGHTS = [1, 2, 3, 5, 8];

/* ------------------------------------------------------------------ */
/* Datum                                                               */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');

export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayIso = () => isoDate(new Date());

/** 'YYYY-MM-DD' -> Tagesnummer (UTC-Mitternacht / 864e5), DST-frei. */
export function dayNum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return NaN;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5);
}

export function fromDayNum(n) {
  const d = new Date(n * 864e5);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function validIso(iso) {
  const n = dayNum(iso);
  return Number.isFinite(n) && fromDayNum(n) === iso;
}

/**
 * Tastatureingabe -> 'YYYY-MM-DD', '' für leer, null für unlesbar.
 * Erkannt: 2026-09-27, 27.09.2026, 27.9.26, 27.9. (dieses Jahr), 270926,
 * 27092026, h/heute, m/morgen, +7/-3 (Tage ab heute).
 */
export function parseDateInput(text, today = todayIso()) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return '';
  const t = dayNum(today);
  if (s === 'h' || s === 'heute') return today;
  if (s === 'm' || s === 'morgen') return fromDayNum(t + 1);
  if (s === 'g' || s === 'gestern') return fromDayNum(t - 1);
  let m = /^([+-])(\d{1,4})$/.exec(s);
  if (m) return fromDayNum(t + (m[1] === '+' ? 1 : -1) * Number(m[2]));
  const year = Number(today.slice(0, 4));
  let y; let mo; let d;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(s))) {
    d = +m[1]; mo = +m[2];
    y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
  } else if ((m = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(s))) {
    d = +m[1]; mo = +m[2]; y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return validIso(iso) ? iso : null;
}

export function formatDate(iso, { year = true } = {}) {
  if (!validIso(iso)) return '';
  const [y, m, d] = iso.split('-');
  return year ? `${Number(d)}.${Number(m)}.${y}` : `${Number(d)}.${Number(m)}.`;
}

/* ------------------------------------------------------------------ */
/* Anlegen und Normalisieren                                           */
/* ------------------------------------------------------------------ */

export function newId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export const emptyState = () => ({ schema: SCHEMA, projects: [] });

export function newProject(fields = {}) {
  const now = new Date().toISOString();
  return normalizeProject({
    id: newId(), title: 'Neues Projekt', status: 'aktiv', color: COLORS[0],
    start: todayIso(), due: null, created: now, updated: now, milestones: [], notes: '', ...fields,
  });
}

export const newMilestone = (fields = {}) => normalizeMilestone({ id: newId(), title: 'Meilenstein', ...fields });
export const newTask = (fields = {}) => normalizeTask({ id: newId(), title: '', ...fields });

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const dateOrNull = (v) => (validIso(v) ? v : null);

export function normalizeTask(t) {
  const w = Number(t && t.weight);
  const done = !!(t && t.done);
  return {
    id: str(t && t.id, 64) || newId(),
    title: str(t && t.title, 500),
    done,
    doneAt: done ? dateOrNull(t.doneAt) : null,
    weight: WEIGHTS.includes(w) ? w : 1,
  };
}

export function normalizeMilestone(m) {
  const done = !!(m && m.done);
  return {
    id: str(m && m.id, 64) || newId(),
    title: str(m && m.title, 300),
    due: dateOrNull(m && m.due),
    done,
    doneAt: done ? dateOrNull(m.doneAt) : null,
    tasks: Array.isArray(m && m.tasks) ? m.tasks.map(normalizeTask) : [],
  };
}

export function normalizeProject(p) {
  const status = STATUS_LABEL[p && p.status] ? p.status : 'aktiv';
  return {
    id: str(p && p.id, 64) || newId(),
    title: str(p && p.title, 200) || 'Ohne Titel',
    description: str(p && p.description, 1000),
    status,
    color: /^#[0-9a-f]{6}$/i.test((p && p.color) || '') ? p.color : COLORS[0],
    start: dateOrNull(p && p.start),
    due: dateOrNull(p && p.due),
    created: str(p && p.created, 40) || new Date().toISOString(),
    updated: str(p && p.updated, 40) || new Date().toISOString(),
    notes: str(p && p.notes, 100000),
    milestones: Array.isArray(p && p.milestones) ? p.milestones.map(normalizeMilestone) : [],
  };
}

/** Beliebige Eingabe (localStorage, Server, Import) -> gültiger Zustand. */
export function normalizeState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.projects)) return emptyState();
  const seen = new Set();
  const projects = [];
  for (const raw of s.projects) {
    const p = normalizeProject(raw);
    if (seen.has(p.id)) p.id = newId();
    seen.add(p.id);
    projects.push(p);
  }
  return { schema: SCHEMA, projects };
}

/* ------------------------------------------------------------------ */
/* Fortschritt                                                         */
/* ------------------------------------------------------------------ */

/**
 * Die zählenden Einheiten eines Meilensteins: seine Aufgaben, oder — hat er
 * keine — er selbst mit Gewicht 1.
 */
export function unitsOf(m) {
  if (m.tasks.length) {
    return m.tasks.map((t) => ({ weight: t.weight, done: t.done, doneAt: t.doneAt }));
  }
  return [{ weight: 1, done: m.done, doneAt: m.doneAt }];
}

function ratio(units) {
  let total = 0; let done = 0;
  for (const u of units) { total += u.weight; if (u.done) done += u.weight; }
  return { total, done, value: total > 0 ? done / total : null };
}

export const milestoneProgress = (m) => ratio(unitsOf(m));
export const milestoneComplete = (m) => milestoneProgress(m).value === 1;

export function projectUnits(p) {
  return p.milestones.flatMap(unitsOf);
}

export const projectProgress = (p) => ratio(projectUnits(p));

export function taskCounts(p) {
  let open = 0; let done = 0;
  for (const m of p.milestones) {
    for (const t of m.tasks) { if (t.done) done += 1; else open += 1; }
  }
  return { open, done, total: open + done };
}

/**
 * Stützstellen der Soll-Kurve als [[tag, anteil], …], monoton in beiden
 * Koordinaten, erster Punkt (Beginn, 0), letzter mit Anteil 1.
 * null, wenn kein Soll definiert ist.
 */
export function plannedCurve(p) {
  const s = dayNum(p.start);
  if (!Number.isFinite(s)) return null;
  const total = projectProgress(p).total;
  const projectDue = dayNum(p.due);

  if (total === 0) {
    if (!Number.isFinite(projectDue) || projectDue <= s) return null;
    return [[s, 0], [projectDue, 1]];
  }

  const items = [];
  for (const m of p.milestones) {
    let due = dayNum(m.due);
    if (!Number.isFinite(due)) due = projectDue;
    if (!Number.isFinite(due)) return null;          // ein Meilenstein ohne erreichbares Datum
    items.push({ due: Math.max(due, s), weight: milestoneProgress(m).total });
  }
  items.sort((a, b) => a.due - b.due);

  const pts = [[s, 0]];
  let cum = 0;
  for (const it of items) {
    cum += it.weight;
    const last = pts[pts.length - 1];
    if (last[0] === it.due) last[1] = cum / total;   // gleicher Tag: Sprung
    else pts.push([it.due, cum / total]);
  }
  // Rundungsrest: der letzte Punkt ist per Konstruktion 1.
  pts[pts.length - 1][1] = 1;
  if (pts.length === 1) return null;                 // alles am Beginn fällig: kein Verlauf
  return pts;
}

/** Soll-Anteil am Tag t (Tagesnummer). */
export function plannedAt(curve, t) {
  if (!curve) return null;
  if (t <= curve[0][0]) return 0;
  for (let i = 1; i < curve.length; i += 1) {
    const [x1, y1] = curve[i];
    if (t <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + (y1 - y0) * ((t - x0) / (x1 - x0));
    }
  }
  return 1;
}

/**
 * Erster Tag, an dem das Soll den Wert v erreicht (Umkehrung von plannedAt,
 * auf ganze Tage aufgerundet). Für v = 0 der Beginn.
 */
export function plannedDayFor(curve, v) {
  if (!curve) return null;
  if (v <= 0 || v <= curve[0][1]) return curve[0][0];
  for (let i = 1; i < curve.length; i += 1) {
    const [x1, y1] = curve[i];
    if (v <= y1 + 1e-12) {
      const [x0, y0] = curve[i - 1];
      if (y1 === y0) return x1;
      return Math.ceil(x0 + (x1 - x0) * ((v - y0) / (y1 - y0)) - 1e-9);
    }
  }
  return curve[curve.length - 1][0];
}

/**
 * Ist-Verlauf: Anteil erledigt bis einschließlich Tag t. Erledigte Einheiten
 * ohne Datum (etwa aus einem Import) zählen ab Projektbeginn.
 */
export function actualSeries(p, fromDay, toDay) {
  const units = projectUnits(p);
  const total = units.reduce((a, u) => a + u.weight, 0);
  if (!total || !(toDay >= fromDay)) return [];
  const fallback = Number.isFinite(dayNum(p.start)) ? dayNum(p.start) : fromDay;
  const byDay = new Map();
  for (const u of units) {
    if (!u.done) continue;
    let d = dayNum(u.doneAt);
    if (!Number.isFinite(d)) d = fallback;
    byDay.set(d, (byDay.get(d) || 0) + u.weight);
  }
  let cum = 0;
  for (const [d, w] of byDay) if (d < fromDay) cum += w;
  const out = [];
  for (let t = fromDay; t <= toDay; t += 1) {
    cum += byDay.get(t) || 0;
    out.push([t, cum / total]);
  }
  return out;
}

/**
 * Prognose des Fertigstellungstags aus dem Tempo der letzten `window` Tage.
 * Rein lineare Fortschreibung — eine Faustzahl, keine Vorhersage.
 */
export function forecast(p, today = dayNum(todayIso()), window = 28) {
  const { total, done } = projectProgress(p);
  if (!total) return null;
  if (done >= total) return { finished: true };
  let recent = 0;
  for (const u of projectUnits(p)) {
    const d = dayNum(u.doneAt);
    if (u.done && Number.isFinite(d) && d > today - window && d <= today) recent += u.weight;
  }
  if (recent === 0) return { finished: false, day: null, rate: 0 };
  const rate = recent / window;                        // Gewicht je Tag
  return { finished: false, day: today + Math.ceil((total - done) / rate), rate };
}

/**
 * Kennzahlen für Karte und Kopf.
 *   ist, soll        Anteile in [0,1] oder null
 *   lagDays          >0 Rückstand, <0 Vorsprung (Tage), null ohne Soll
 *   health           'fertig' | 'gut' | 'knapp' | 'verzug' | 'ueberfaellig' | null
 */
export function summarize(p, today = dayNum(todayIso())) {
  const prog = projectProgress(p);
  const curve = plannedCurve(p);
  const ist = prog.value;
  const soll = curve ? plannedAt(curve, today) : null;
  let lagDays = null;
  if (curve && ist != null) {
    lagDays = ist >= 1 ? null : today - plannedDayFor(curve, ist);
  }
  const due = dayNum(p.due);
  let health = null;
  if (ist === 1) health = 'fertig';
  else if (p.status === 'aktiv') {
    if (Number.isFinite(due) && today > due) health = 'ueberfaellig';
    else if (lagDays != null) health = lagDays <= 3 ? 'gut' : lagDays <= 14 ? 'knapp' : 'verzug';
  }
  return {
    ist, soll, lagDays, health, curve,
    total: prog.total, doneWeight: prog.done,
    tasks: taskCounts(p),
    next: nextMilestone(p),
    overdueMilestones: p.milestones.filter((m) => !milestoneComplete(m) && dayNum(m.due) < today).length,
    forecast: forecast(p, today),
  };
}

/** Nächster offener Meilenstein: nach Datum, undatierte zuletzt, sonst Listenfolge. */
export function nextMilestone(p) {
  const open = p.milestones
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !milestoneComplete(m));
  open.sort((a, b) => {
    const da = dayNum(a.m.due); const db = dayNum(b.m.due);
    const fa = Number.isFinite(da); const fb = Number.isFinite(db);
    if (fa && fb && da !== db) return da - db;
    if (fa !== fb) return fa ? -1 : 1;
    return a.i - b.i;
  });
  return open.length ? open[0].m : null;
}

/* ------------------------------------------------------------------ */
/* Sortierung der Übersicht                                            */
/* ------------------------------------------------------------------ */

const STATUS_RANK = { aktiv: 0, geplant: 1, pausiert: 2, abgeschlossen: 3, verworfen: 4 };

export function sortProjects(list, mode, today = dayNum(todayIso())) {
  const arr = list.map((p, i) => ({ p, i, s: summarize(p, today) }));
  const byDue = (a, b) => {
    const da = dayNum(a.p.due); const db = dayNum(b.p.due);
    const fa = Number.isFinite(da); const fb = Number.isFinite(db);
    if (fa && fb) return da - db;
    return fa === fb ? 0 : fa ? -1 : 1;
  };
  const cmp = {
    status: (a, b) => (STATUS_RANK[a.p.status] - STATUS_RANK[b.p.status]) || byDue(a, b) || a.i - b.i,
    faellig: (a, b) => byDue(a, b) || a.i - b.i,
    rueckstand: (a, b) => ((b.s.lagDays ?? -1e9) - (a.s.lagDays ?? -1e9)) || a.i - b.i,
    fortschritt: (a, b) => ((a.s.ist ?? -1) - (b.s.ist ?? -1)) || a.i - b.i,
    name: (a, b) => a.p.title.localeCompare(b.p.title, 'de') || a.i - b.i,
  }[mode] || ((a, b) => a.i - b.i);
  return arr.sort(cmp).map((x) => x.p);
}
