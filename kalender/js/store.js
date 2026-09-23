// store.js — Zustand + austauschbare Persistenzschicht.
//
// Der Store kennt die Speicherung nicht. Er spricht nur das Adapter-Interface
//     load()  -> Promise<state|null>
//     save(s) -> Promise<boolean>
// Ein spaeterer Server-Adapter (Backend beim Vater, Cloudflare Worker, ...)
// implementiert dieselben zwei Methoden; am uebrigen Code aendert sich nichts.

export const SCHEMA_VERSION = 1;

export const DEFAULT_CATEGORIES = [
  { id: 'forschung', name: 'Forschung',  color: '#0ea5a4' },
  { id: 'lehre',     name: 'Lehre',      color: '#6366f1' },
  { id: 'uni',       name: 'Uni-Termine', color: '#0369a1' },
  { id: 'sport',     name: 'Sport',      color: '#f59e0b' },
  { id: 'privat',    name: 'Privat',     color: '#db2777' },
  { id: 'sonstiges', name: 'Sonstiges',  color: '#64748b' },
];

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    events: [],
    tasks: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: { defaultCategory: 'forschung', scrollHour: 7 },
  };
}

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
    const t = {
      id: uid(),
      date: dateYmd,
      title: String(title).trim(),
      done: false,
      order: Date.now(),
    };
    if (!t.title) return null;
    this.mutate((s) => { s.tasks.push(t); });
    return t;
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

  tasksFor(dateYmd) {
    return this.state.tasks
      .filter((t) => t.date === dateYmd)
      .sort((a, b) => (a.done - b.done) || (a.order - b.order));
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
        }
      : null,
    exdates: Array.isArray(ev.exdates) ? [...ev.exdates] : [],
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
  }));
  if (!Array.isArray(s.categories) || !s.categories.length) {
    s.categories = base.categories;
  }
  s.settings = { ...base.settings, ...(state.settings || {}) };
  return s;
}
