// store.js — Zustand + austauschbare Persistenzschicht.
//
// Der Store kennt die Speicherung nicht. Er spricht nur das Adapter-Interface
//     load()  -> Promise<state|null>
//     save(s) -> Promise<boolean>
// Ein spaeterer Server-Adapter (Backend beim Vater, Cloudflare Worker, ...)
// implementiert dieselben zwei Methoden; am uebrigen Code aendert sich nichts.

export const SCHEMA_VERSION = 2;

/** Standardhoehe eines Aufgabenblocks in Pixeln. */
export const DEFAULT_TASK_HEIGHT = 44;
export const MIN_TASK_HEIGHT = 34;
export const MAX_TASK_HEIGHT = 400;

export const DEFAULT_CATEGORIES = [
  { id: 'forschung', name: 'Forschung',  color: '#0ea5a4' },
  { id: 'lehre',     name: 'Lehre',      color: '#6366f1' },
  { id: 'uni',       name: 'Uni-Termine', color: '#0369a1' },
  { id: 'sport',     name: 'Sport',      color: '#f59e0b' },
  { id: 'privat',    name: 'Privat',     color: '#db2777' },
  { id: 'geburtstag', name: 'Geburtstage', color: '#9333ea' },
  { id: 'sonstiges', name: 'Sonstiges',  color: '#64748b' },
];

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    events: [],
    tasks: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    // Tagebuch: { 'YYYY-MM-DD': { values: {feldId: wert}, entry: 'Freitext' } }
    journal: {},
    // Das Feldschema liegt im Zustand, nicht im Code: so wandert es in die
    // Sicherung und ueberlebt spaetere Aenderungen an der Feldliste.
    journalSchema: DEFAULT_JOURNAL_SCHEMA.map((f) => ({ ...f })),
    settings: { defaultCategory: 'forschung', scrollHour: 7 },
  };
}

/* ------------------------------------------------------------------ */
/* Tagebuch-Feldschema                                                 */
/* ------------------------------------------------------------------ */
//
// Typen:
//   number   Zahl mit Einheit
//   scale5   Skala 1-5
//   bool     ja/nein
//   text     einzeilig
//   numtext  Zahl (Minuten) UND ein eigenes Textfeld
//   computed abgeleitet, nicht eingebbar (siehe journal.js)

export const DEFAULT_JOURNAL_SCHEMA = [
  { id: 'schlafzeit',      label: 'Schlafzeit',        type: 'number',   unit: 'h',   step: 0.25 },
  { id: 'mathezeit',       label: 'Mathezeit',         type: 'computed', unit: 'h',   formula: 'mathe' },
  { id: 'sportzeit',       label: 'Sportzeit',         type: 'computed', unit: 'h',   formula: 'sport' },
  { id: 'schlafqualitaet', label: 'Schlafqualität',    type: 'scale5' },
  { id: 'klimmzuege',      label: 'Klimmzüge',         type: 'number',   unit: '',    step: 1 },
  { id: 'mobilisation',    label: 'Mobilisation',      type: 'bool' },
  { id: 'kraft',           label: 'Kraft',             type: 'bool' },
  { id: 'kaltedusche',     label: 'Kalte Dusche',      type: 'bool' },
  { id: 'fruehstueck',     label: 'Frühstück',         type: 'text' },
  { id: 'morgenlektuere',  label: 'Morgenlektüre',     type: 'text' },
  { id: 'sport1',          label: 'Sporteinheit 1',    type: 'numtext',  unit: 'min' },
  { id: 'fruehstueck2',    label: 'Frühstück 2',       type: 'text' },
  { id: 'papervortrag',    label: 'Papervortrag',      type: 'text' },
  { id: 'arxiv',           label: 'arXiv',             type: 'text' },
  { id: 'paper',           label: 'Paper',             type: 'numtext',  unit: 'min' },
  { id: 'forschung',       label: 'Forschung',         type: 'numtext',  unit: 'min' },
  { id: 'sport2',          label: 'Sporteinheit 2',    type: 'numtext',  unit: 'min' },
  { id: 'mittagessen',     label: 'Mittagessen',       type: 'text' },
  { id: 'nachrichten',     label: 'Nachrichten',       type: 'bool' },
  { id: 'nap',             label: 'Nap',               type: 'number',   unit: 'min', step: 5 },
  { id: 'lehrbuchvortrag', label: 'Lehrbuchvortrag',   type: 'numtext',  unit: 'min' },
  { id: 'lektuere',        label: 'Lektüre',           type: 'numtext',  unit: 'min' },
  { id: 'anki',            label: 'Anki',              type: 'number',   unit: 'min', step: 5 },
  { id: 'diverseaufgaben', label: 'Diverse Aufgaben',  type: 'text' },
  { id: 'sport3',          label: 'Sporteinheit 3',    type: 'numtext',  unit: 'min' },
  { id: 'projekt',         label: 'Projekt',           type: 'numtext',  unit: 'min' },
  { id: 'dehnen',          label: 'Dehnen',            type: 'bool' },
  { id: 'abendlektuere',   label: 'Abendlektüre',      type: 'text' },
];

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

/**
 * localStorage-Adapter. Faellt bei blockiertem Storage (Inkognito, strenge
 * Browser-Einstellungen) still auf reinen Arbeitsspeicher zurueck und meldet
 * das ueber `degraded`, damit die UI warnen kann.
 */
export class LocalStorageAdapter {
  constructor(key = 'kalender.v1') {
    this.key = key;
    this.degraded = false;
    this._memory = null;
  }

  async load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[kalender] localStorage nicht lesbar:', err);
      this.degraded = true;
      return this._memory;
    }
  }

  async save(state) {
    this._memory = state;
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
      return true;
    } catch (err) {
      console.warn('[kalender] localStorage nicht schreibbar:', err);
      this.degraded = true;
      return false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = emptyState();
    this._listeners = new Set();
    this._saveTimer = null;
    this.lastSaveOk = true;
  }

  async init() {
    const loaded = await this.adapter.load();
    if (loaded) this.state = migrate(loaded);
    this._emit();
    return this.state;
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) {
      try { fn(this.state); } catch (err) { console.error(err); }
    }
  }

  /** Zustand aendern, Abonnenten benachrichtigen, Speichern entprellen. */
  mutate(fn) {
    fn(this.state);
    this._emit();
    this._scheduleSave();
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 250);
  }

  async flush() {
    clearTimeout(this._saveTimer);
    this.lastSaveOk = await this.adapter.save(this.state);
    return this.lastSaveOk;
  }

  /* ---- Termine ---- */

  addEvent(ev) {
    const full = normalizeEvent({ ...ev, id: ev.id || uid() });
    this.mutate((s) => { s.events.push(full); });
    return full;
  }

  updateEvent(id, patch) {
    this.mutate((s) => {
      const i = s.events.findIndex((e) => e.id === id);
      if (i >= 0) s.events[i] = normalizeEvent({ ...s.events[i], ...patch });
    });
  }

  deleteEvent(id) {
    this.mutate((s) => { s.events = s.events.filter((e) => e.id !== id); });
  }

  /** Einzelne Instanz einer Serie ausnehmen (EXDATE). */
  excludeOccurrence(id, dateYmd) {
    this.mutate((s) => {
      const ev = s.events.find((e) => e.id === id);
      if (!ev) return;
      ev.exdates = Array.from(new Set([...(ev.exdates || []), dateYmd])).sort();
    });
  }

  /* ---- Aufgaben ---- */

  addTask(dateYmd, title) {
    const title_ = String(title).trim();
    if (!title_) return null;
    // Ans Ende der offenen Aufgaben dieses Tages.
    const maxOrder = this.state.tasks
      .filter((x) => x.date === dateYmd)
      .reduce((mx, x) => Math.max(mx, x.order), -1);
    const t = {
      id: uid(),
      date: dateYmd,
      title: title_,
      done: false,
      order: maxOrder + 1,
      height: DEFAULT_TASK_HEIGHT,
    };
    this.mutate((s) => { s.tasks.push(t); });
    return t;
  }

  /**
   * Setzt die Reihenfolge eines Tages neu. `ids` ist die gewuenschte
   * Reihenfolge; alles, was nicht darin steht, behaelt seinen Platz dahinter.
   */
  reorderTasks(dateYmd, ids) {
    this.mutate((s) => {
      const rank = new Map(ids.map((id, i) => [id, i]));
      for (const t of s.tasks) {
        if (t.date !== dateYmd) continue;
        if (rank.has(t.id)) t.order = rank.get(t.id);
        else t.order = ids.length + t.order;
      }
    });
  }

  /** Aufgabe auf einen anderen Tag schieben, an die gewuenschte Position. */
  moveTask(id, dateYmd, index) {
    this.mutate((s) => {
      const t = s.tasks.find((x) => x.id === id);
      if (!t) return;
      t.date = dateYmd;
      const others = s.tasks
        .filter((x) => x.date === dateYmd && x.id !== id)
        .sort((a, b) => a.order - b.order);
      others.splice(Math.max(0, Math.min(index, others.length)), 0, t);
      others.forEach((x, i) => { x.order = i; });
    });
  }

  updateTask(id, patch) {
    this.mutate((s) => {
      const i = s.tasks.findIndex((t) => t.id === id);
      if (i >= 0) s.tasks[i] = { ...s.tasks[i], ...patch };
    });
  }

  deleteTask(id) {
    this.mutate((s) => { s.tasks = s.tasks.filter((t) => t.id !== id); });
  }

  /** Aufgaben eines Tages: offene zuerst, erledigte darunter, je nach Reihenfolge. */
  tasksFor(dateYmd) {
    return this.state.tasks
      .filter((t) => t.date === dateYmd)
      .sort((a, b) => (a.done - b.done) || (a.order - b.order));
  }

  /* ---- Tagebuch ---- */

  journalFor(dateYmd) {
    return this.state.journal[dateYmd] || { values: {}, entry: '' };
  }

  setJournalValue(dateYmd, fieldId, value) {
    this.mutate((s) => {
      if (!s.journal[dateYmd]) s.journal[dateYmd] = { values: {}, entry: '' };
      if (value === null || value === undefined || value === '') delete s.journal[dateYmd].values[fieldId];
      else s.journal[dateYmd].values[fieldId] = value;
    });
  }

  setJournalEntry(dateYmd, text) {
    this.mutate((s) => {
      if (!s.journal[dateYmd]) s.journal[dateYmd] = { values: {}, entry: '' };
      s.journal[dateYmd].entry = String(text);
    });
  }

  /** Offene Aufgaben aller Tage vor `dateYmd` auf diesen Tag ziehen. */
  carryOverOpenTasks(dateYmd) {
    let moved = 0;
    this.mutate((s) => {
      for (const t of s.tasks) {
        if (!t.done && t.date < dateYmd) { t.date = dateYmd; moved += 1; }
      }
    });
    return moved;
  }

  /* ---- Kategorien ---- */

  category(id) {
    return this.state.categories.find((c) => c.id === id)
        || { id: 'sonstiges', name: 'Sonstiges', color: '#64748b' };
  }

  /* ---- Backup ---- */

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }

  importJSON(text, { merge = false } = {}) {
    const parsed = migrate(JSON.parse(text));
    this.mutate((s) => {
      if (merge) {
        const known = new Set(s.events.map((e) => e.id));
        for (const e of parsed.events) if (!known.has(e.id)) s.events.push(e);
        const kt = new Set(s.tasks.map((t) => t.id));
        for (const t of parsed.tasks) if (!kt.has(t.id)) s.tasks.push(t);
      } else {
        s.events = parsed.events;
        s.tasks = parsed.tasks;
        s.categories = parsed.categories;
        s.settings = parsed.settings;
      }
    });
  }
}

/* ------------------------------------------------------------------ */

export function normalizeEvent(ev) {
  const out = {
    id: ev.id || uid(),
    title: (ev.title ?? '').toString(),
    allDay: !!ev.allDay,
    start: ev.start,
    end: ev.end,
    category: ev.category || 'sonstiges',
    notes: (ev.notes ?? '').toString(),
    rrule: ev.rrule && ev.rrule.freq && ev.rrule.freq !== 'NONE'
      ? {
          freq: ev.rrule.freq,
          interval: Math.max(1, Number(ev.rrule.interval) || 1),
          byDay: Array.isArray(ev.rrule.byDay) ? [...ev.rrule.byDay].sort((a, b) => a - b) : null,
          count: ev.rrule.count ? Math.max(1, Number(ev.rrule.count)) : null,
          until: ev.rrule.until || null,
          leapFallback: !!ev.rrule.leapFallback,
        }
      : null,
    exdates: Array.isArray(ev.exdates) ? [...ev.exdates] : [],
    // Nur bei Geburtstagen gesetzt: erlaubt, das Alter pro Instanz zu
    // berechnen, statt es fest in den Titel zu schreiben (in einer Serie
    // waere es dann fuer alle Jahre bis auf eines falsch).
    birthYear: Number.isInteger(ev.birthYear) ? ev.birthYear : null,
  };
  if (out.allDay) {
    out.start = String(out.start).slice(0, 10);
    out.end = String(out.end || out.start).slice(0, 10);
    if (out.end < out.start) out.end = out.start;
  } else {
    out.start = String(out.start).slice(0, 16);
    out.end = String(out.end || out.start).slice(0, 16);
    if (out.end < out.start) out.end = out.start;
  }
  return out;
}

export function clampHeight(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return DEFAULT_TASK_HEIGHT;
  return Math.max(MIN_TASK_HEIGHT, Math.min(MAX_TASK_HEIGHT, Math.round(n)));
}

/** Platzhalter fuer spaetere Schema-Migrationen. */
export function migrate(state) {
  const base = emptyState();
  const s = { ...base, ...state };
  s.version = SCHEMA_VERSION;
  s.events = (s.events || []).map(normalizeEvent);
  s.tasks = (s.tasks || []).map((t) => ({
    id: t.id || uid(),
    date: String(t.date).slice(0, 10),
    title: String(t.title ?? ''),
    done: !!t.done,
    order: Number(t.order) || 0,
    height: clampHeight(t.height),
  }));
  // Alte Staende hatten order = Date.now(); das sind riesige Zahlen, die
  // zwar richtig sortieren, aber nach dem ersten Ziehen mit den neuen
  // kleinen Indizes kollidieren wuerden. Einmalig je Tag neu durchnummerieren.
  const byDay = new Map();
  for (const t of s.tasks) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.order - b.order).forEach((t, i) => { t.order = i; });
  }

  s.journal = (s.journal && typeof s.journal === 'object') ? s.journal : {};
  for (const [k, v] of Object.entries(s.journal)) {
    s.journal[k] = {
      values: (v && typeof v.values === 'object') ? v.values : {},
      entry: String(v?.entry ?? ''),
    };
  }
  if (!Array.isArray(s.journalSchema) || !s.journalSchema.length) {
    s.journalSchema = DEFAULT_JOURNAL_SCHEMA.map((f) => ({ ...f }));
  } else {
    // Neu hinzugekommene Felder nachtragen, ohne die Reihenfolge des
    // Bestands umzuwerfen.
    const known = new Set(s.journalSchema.map((f) => f.id));
    for (const f of DEFAULT_JOURNAL_SCHEMA) if (!known.has(f.id)) s.journalSchema.push({ ...f });
  }
  if (!Array.isArray(s.categories) || !s.categories.length) {
    s.categories = base.categories;
  } else {
    // Neu hinzugekommene Standardkategorien nachtragen, ohne eigene Farben
    // oder Namen zu ueberschreiben.
    const known = new Set(s.categories.map((c) => c.id));
    for (const c of base.categories) if (!known.has(c.id)) s.categories.push({ ...c });
  }
  s.settings = { ...base.settings, ...(state.settings || {}) };
  return s;
}
