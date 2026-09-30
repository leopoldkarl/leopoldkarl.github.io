// store.js — Zustand im Speicher, verschlüsselte Ablage, Rückgängig, zweites Fenster.
//
// Schnittstelle wie /projekte/js/store.js (state, subscribe, commit, undo,
// adoptExternal), damit sync.js unverändert daran hängen kann. Unterschied:
// geschrieben wird nicht JSON, sondern das AES-GCM-Chiffrat des Zustands.
// Verschlüsseln ist asynchron; die Schreibvorgänge laufen deshalb in einer
// Kette, damit ein älterer Stand nie einen neueren überholt.

import { normalizeState, emptyState } from './model.js';
import { sealState, openBlob, readVaultRaw, writeVaultRaw, VAULT_KEY } from './vault.js';

const SAVE_DEBOUNCE = 200;
const UNDO_MAX = 50;

export class Store {
  constructor() {
    this.state = emptyState();
    this.keyObj = null;           // { key: CryptoKey, salt, iterations } — entsperrt
    this.listeners = new Set();
    this.undoStack = [];
    this.lastRaw = null;
    this._timer = null;
    this._chain = Promise.resolve();
    this.storageOk = true;
    this._watching = false;
  }

  get unlocked() { return !!this.keyObj; }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _notify(meta) { for (const fn of this.listeners) fn(this.state, meta); }

  /** Nach dem Entsperren: Schlüssel und entschlüsselten Zustand übernehmen. */
  open(keyObj, state, { write = false } = {}) {
    this.keyObj = keyObj;
    this.state = normalizeState(state);
    this.undoStack = [];
    this.lastRaw = readVaultRaw();
    if (write) this._writeNow();
    this._notify({ label: 'open', external: true });
  }

  /** Sperren: ausstehendes Schreiben abschließen, dann alles aus dem Speicher. */
  async close() {
    await this.flush();
    this.keyObj = null;
    this.state = emptyState();
    this.undoStack = [];
    this._notify({ label: 'lock', external: true });
  }

  /** Anderen Schlüssel verwenden (z. B. Salz vom Server) und sofort neu schreiben. */
  rekey(keyObj) {
    this.keyObj = keyObj;
    return this._writeNow();
  }

  commit(mutate, label = '', extra = {}) {
    if (!this.keyObj) return;
    this.undoStack.push({ label, snap: JSON.stringify(this.state) });
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    mutate(this.state);
    this.state = normalizeState(this.state);
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

  replace(next, label = 'Import') {
    this.commit((s) => {
      const n = normalizeState(next);
      s.accounts = n.accounts; s.entries = n.entries; s.rates = n.rates;
    }, label);
  }

  /** Fremden Stand übernehmen (Server, anderes Fenster) — ohne Undo. */
  adoptExternal(next, { write = true } = {}) {
    this.state = normalizeState(next);
    this.undoStack = [];
    if (write) this._writeNow();
    this._notify({ label: 'extern', external: true });
  }

  _scheduleSave() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this._writeNow(); }, SAVE_DEBOUNCE);
  }

  async flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; this._writeNow(); }
    await this._chain;
  }

  _writeNow() {
    const keyObj = this.keyObj;
    if (!keyObj) return this._chain;
    const snap = JSON.parse(JSON.stringify(this.state));
    this._chain = this._chain
      .then(async () => {
        const blob = await sealState(keyObj, snap);
        this.lastRaw = writeVaultRaw(JSON.stringify(blob));
        this.storageOk = true;
      })
      .catch(() => { this.storageOk = false; });
    return this._chain;
  }

  /**
   * Zweites Fenster desselben Browsers: storage-Ereignis auf dem Chiffrat.
   * Passt der Schlüssel nicht mehr (anderes Fenster hat mit dem Salz des
   * Servers neu verschlüsselt), wird `onForeignKey` gerufen — dann sperrt die
   * Seite, statt still auf einem veralteten Stand weiterzuschreiben.
   */
  watchOtherWindows({ onAdopt, onForeignKey } = {}) {
    if (this._watching) return;
    this._watching = true;
    const check = async (raw) => {
      if (!this.keyObj || raw == null || raw === this.lastRaw) return;
      await this.flush();
      if (raw === this.lastRaw) return;
      let next;
      try { next = await openBlob(this.keyObj, JSON.parse(raw)); } catch {
        if (onForeignKey) onForeignKey();
        return;
      }
      this.lastRaw = raw;
      this.adoptExternal(next, { write: false });
      if (onAdopt) onAdopt();
    };
    const poll = () => { check(readVaultRaw()); };
    window.addEventListener('storage', (e) => { if (e.key === VAULT_KEY) check(e.newValue); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush(); else poll();
    });
    window.addEventListener('focus', poll);
    window.addEventListener('pagehide', () => { this.flush(); });
  }
}

export const findAccount = (s, id) => s.accounts.find((a) => a.id === id) || null;
export const findEntry = (s, id) => s.entries.find((e) => e.id === id) || null;
