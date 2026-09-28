// store.js — Zustand, lokale Ablage, Rückgängig, Abgleich zwischen Fenstern.
//
// Dieselbe Aufteilung wie im Kalender: der localStorage ist die lokale
// Wahrheit und der Zwischenspeicher für den Abgleich mit dem Worker
// (sync.js hört über `subscribe` zu und liest `state`). Ein zweites Fenster
// desselben Browsers wird über das storage-Ereignis nachgezogen; dabei gilt
// „zuletzt geschrieben gewinnt“, und der Undo-Stapel wird verworfen, weil
// seine Schnappschüsse einen Zustand beschreiben, den es nicht mehr gibt.

import { normalizeState, emptyState } from './model.js';

export const STORAGE_KEY = 'projekte.state';
const SAVE_DEBOUNCE = 250;
const UNDO_MAX = 50;

export class Store {
  constructor() {
    this.state = emptyState();
    this.listeners = new Set();
    this.undoStack = [];
    this.lastRaw = null;
    this._timer = null;
    this.storageOk = true;
  }

  load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { this.storageOk = false; }
    this.lastRaw = raw;
    if (raw) {
      try { this.state = normalizeState(JSON.parse(raw)); } catch { this.state = emptyState(); }
    }
    return this.state;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _notify(meta) { for (const fn of this.listeners) fn(this.state, meta); }

  /**
   * Eine Änderung: Schnappschuss für Rückgängig, Mutation, speichern, melden.
   * `mutate` bekommt den Zustand und ändert ihn an Ort und Stelle.
   */
  commit(mutate, label = '', extra = {}) {
    this.undoStack.push({ label, snap: JSON.stringify(this.state) });
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    mutate(this.state);
    this._scheduleSave();
    this._notify({ label, ...extra });
  }

  undo() {
    const top = this.undoStack.pop();
    if (!top) return null;
    this.state = normalizeState(JSON.parse(top.snap));
    this._scheduleSave();
    this._notify({ label: 'undo' });
    return top.label || 'Änderung';
  }

  /** Ganzen Zustand ersetzen (Import); rückgängig machbar. */
  replace(next, label = 'Import') {
    this.commit((s) => { s.projects = normalizeState(next).projects; }, label);
  }

  /** Fremden Zustand übernehmen (Server, anderes Fenster) — ohne Zurückschreiben ins Undo. */
  adoptExternal(next, { write = true } = {}) {
    this.state = normalizeState(next);
    this.undoStack = [];
    if (write) this._writeNow();
    this._notify({ label: 'extern', external: true });
  }

  _scheduleSave() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._writeNow(), SAVE_DEBOUNCE);
  }

  flush() { if (this._timer) { clearTimeout(this._timer); this._writeNow(); } }

  _writeNow() {
    this._timer = null;
    const raw = JSON.stringify(this.state);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      this.lastRaw = raw;
      this.storageOk = true;
    } catch { this.storageOk = false; }
  }

  /** Anderes Fenster: storage-Ereignis plus Nachsehen bei Sichtbarkeit/Fokus. */
  watchOtherWindows(onAdopt) {
    const check = (raw) => {
      if (raw == null || raw === this.lastRaw) return;
      this.flush();
      if (raw === this.lastRaw) return;
      this.lastRaw = raw;
      try {
        this.adoptExternal(JSON.parse(raw), { write: false });
        if (onAdopt) onAdopt();
      } catch { /* kaputter Fremdstand: ignorieren */ }
    };
    const poll = () => { try { check(localStorage.getItem(STORAGE_KEY)); } catch { /* egal */ } };
    window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) check(e.newValue); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('focus', poll);
    window.addEventListener('pageshow', poll);
    window.addEventListener('pagehide', () => this.flush());
  }
}

/* ------------------------------------------------------------------ */
/* Nachschlagen                                                        */
/* ------------------------------------------------------------------ */

export const findProject = (s, id) => s.projects.find((p) => p.id === id) || null;

export function findMilestone(s, pid, mid) {
  const p = findProject(s, pid);
  return p ? p.milestones.find((m) => m.id === mid) || null : null;
}

export function findTask(s, pid, mid, tid) {
  const m = findMilestone(s, pid, mid);
  return m ? m.tasks.find((t) => t.id === tid) || null : null;
}

export function touch(p) { if (p) p.updated = new Date().toISOString(); }
