// sync.js — Abgleich mit dem Worker.
//
// Aufteilung der Zustaendigkeiten:
//   * `store` bleibt unveraendert und schreibt weiter in den localStorage.
//     Der bleibt der Zwischenspeicher: ohne Netz arbeitet der Kalender
//     vollstaendig weiter.
//   * Dieser Client hoert am Store, verschluesselt den Zustand und schiebt ihn
//     zum Server; umgekehrt holt er ihn und reicht ihn an `onRemoteState`
//     weiter — dieselbe Uebernahme, die schon fuer das zweite Fenster
//     desselben Browsers gebaut ist.
//
// Konfliktregel: der Server zaehlt eine Version. Wer schreibt, nennt den
// Stand, auf dem er aufsetzt. Passt der nicht, antwortet der Server mit 409
// und dem aktuellen Block. Zusammenfuehren kann niemand — der Server sieht
// Chiffrat, und zwei Gesamtzustaende lassen sich nicht sinnvoll mischen —,
// also gewinnt der fremde Stand, und der eigene wird vorher als Sicherung im
// localStorage abgelegt, statt weggeworfen zu werden.

import {
  encryptState, decryptState, deriveKey, newSalt, saltOf, iterationsOf, KDF_ITERATIONS,
} from './crypto.js';

const PUSH_DEBOUNCE = 1500;      // ms nach der letzten Aenderung
const POLL_INTERVAL = 90000;     // ms; 960 Abrufe/Tag, Freigrenze 100 000
const CONFLICT_PREFIX = 'kalender.conflict.';
const MAX_CONFLICT_COPIES = 3;
const META_KEY = 'kalender.syncmeta';
export const CONFIG_KEY = 'kalender.sync';

/* ------------------------------------------------------------------ */
/* Konfiguration                                                       */
/* ------------------------------------------------------------------ */

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return (c && c.url && c.token) ? c : null;
  } catch { return null; }
}

export function saveConfig(config) {
  try {
    if (!config) localStorage.removeItem(CONFIG_KEY);
    else localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch { return false; }
}

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || { version: 0, updatedAt: null }; }
  catch { return { version: 0, updatedAt: null }; }
}

function saveMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* egal */ }
}

/**
 * Alle Schluessel des Speichers. Ueber `length`/`key(i)` statt ueber
 * `Object.keys`: Letzteres funktioniert im Browser nur, weil `localStorage`
 * seine Eintraege als eigene Eigenschaften fuehrt — eine Eigenheit, auf die
 * man sich nicht stuetzen muss.
 */
function allKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k != null) out.push(k);
  }
  return out;
}

/** Die verlierende Fassung eines Konflikts aufheben, damit nichts verschwindet. */
export function keepConflictCopy(state) {
  try {
    const key = `${CONFLICT_PREFIX}${new Date().toISOString()}`;
    localStorage.setItem(key, JSON.stringify(state));
    const keys = allKeys().filter((k) => k.startsWith(CONFLICT_PREFIX)).sort();
    while (keys.length > MAX_CONFLICT_COPIES) localStorage.removeItem(keys.shift());
    return key;
  } catch { return null; }
}

export function conflictCopies() {
  try { return allKeys().filter((k) => k.startsWith(CONFLICT_PREFIX)).sort(); }
  catch { return []; }
}

/* ------------------------------------------------------------------ */
/* Einrichten                                                          */
/* ------------------------------------------------------------------ */

/**
 * Schluessel fuer diese Passphrase herstellen und dabei pruefen, ob sie zu dem
 * passt, was schon auf dem Server liegt.
 *
 * Der wesentliche Punkt: liegt dort bereits ein Block, muss das Salz *aus
 * diesem Block* kommen — sonst entstuende auf jedem Geraet ein anderer
 * Schluessel und niemand koennte den anderen lesen. Und es wird sofort
 * probeweise entschluesselt, damit eine vertippte Passphrase beim Einrichten
 * auffaellt und nicht erst beim ersten Abgleich.
 *
 * @returns {Promise<{key: CryptoKey, salt: Uint8Array, iterations: number,
 *                    version: number, remoteState: object|null}>}
 */
export async function establishKey(config, passphrase, fetchImpl) {
  const f = fetchImpl || ((...a) => globalThis.fetch(...a));
  const url = `${String(config.url).replace(/\/+$/, '')}/state`;
  const res = await f(url, { headers: { Authorization: `Bearer ${config.token}` } });
  if (res.status === 401) throw new Error('Das Token wird abgelehnt.');
  if (!res.ok) throw new Error(`Server antwortet ${res.status}.`);
  const body = await res.json();

  if (!body.blob) {
    const salt = newSalt();
    const key = await deriveKey(passphrase, salt);
    return { key, salt, iterations: KDF_ITERATIONS, version: 0, remoteState: null };
  }

  const salt = saltOf(body.blob);
  const iterations = iterationsOf(body.blob);
  const key = await deriveKey(passphrase, salt, iterations);
  let remoteState;
  try {
    remoteState = await decryptState(key, body.blob);
  } catch {
    throw new Error('Die Passphrase passt nicht zu den Daten auf dem Server.');
  }
  return { key, salt, iterations, version: body.version, remoteState };
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export class SyncClient {
  /**
   * @param {object} o
   * @param {{state: object, subscribe: Function}} o.store
   * @param {() => Promise<{key: CryptoKey, salt: Uint8Array}|null>} o.getKey
   * @param {(state: object) => void} o.onRemoteState  Uebernahme eines fremden Standes
   * @param {(status: object) => void} o.onStatus
   * @param {typeof fetch} [o.fetchImpl]
   */
  constructor({ store, getKey, onRemoteState, onStatus, fetchImpl }) {
    this.store = store;
    this.getKey = getKey;
    this.onRemoteState = onRemoteState;
    this.onStatus = onStatus || (() => {});
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));

    this.config = loadConfig();
    this.meta = loadMeta();
    this.state = 'aus';            // aus | gesperrt | ok | offline | konflikt | fehler
    this.detail = '';
    this.applyingRemote = false;
    this._pushTimer = null;
    this._pollTimer = null;
    this._unsubscribe = null;
    this._busy = null;             // laufende Anfrage, damit sich nichts ueberholt
    this.pendingPush = false;
  }

  get enabled() { return !!this.config; }

  _emit(state, detail = '') {
    this.state = state;
    this.detail = detail;
    this.onStatus({ state, detail, version: this.meta.version, updatedAt: this.meta.updatedAt });
  }

  async _request(path, init = {}) {
    const url = `${this.config.url.replace(/\/+$/, '')}${path}`;
    const res = await this.fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    return res;
  }

  /* ---- Start und Ende ---- */

  start() {
    if (!this.config) { this._emit('aus'); return; }
    this._unsubscribe = this.store.subscribe(() => {
      if (this.applyingRemote) return;          // kein Echo auf eine Uebernahme
      this.schedulePush();
    });
    this._pollTimer = setInterval(() => { this.pull(); }, POLL_INTERVAL);
    this.pull();
  }

  stop() {
    if (this._unsubscribe) this._unsubscribe();
    clearTimeout(this._pushTimer);
    clearInterval(this._pollTimer);
    this._unsubscribe = null;
    this._pushTimer = null;
    this._pollTimer = null;
  }

  schedulePush() {
    this.pendingPush = true;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => { this.push(); }, PUSH_DEBOUNCE);
  }

  /* ---- Holen ---- */

  /**
   * Nachsehen und, wenn der Server weiter ist, uebernehmen. Ist der Server
   * leer und lokal etwas da, wird stattdessen hochgeladen — das ist der Fall
   * beim allerersten Einrichten.
   */
  async pull() {
    if (!this.config) return false;
    if (this._busy) return this._busy.then(() => false);
    this._busy = this._pull().finally(() => { this._busy = null; });
    return this._busy;
  }

  async _pull() {
    const key = await this.getKey();
    if (!key) { this._emit('gesperrt'); return false; }

    let head;
    try {
      const res = await this._request('/version');
      if (res.status === 401) { this._emit('fehler', 'Token abgelehnt.'); return false; }
      if (!res.ok) { this._emit('fehler', `Server antwortet ${res.status}.`); return false; }
      head = await res.json();
    } catch (err) {
      this._emit('offline', String(err && err.message ? err.message : err));
      return false;
    }

    if (head.version === 0) {
      // Server leer: eigenen Stand hochladen, statt nichts zu tun.
      // Direkt `_push`, nicht `push`: Letzteres sieht die eigene laufende
      // Anfrage in `_busy` und wuerde den Versuch nur auf einen Timer legen.
      await this._push();
      return false;
    }
    if (head.version <= this.meta.version) {
      if (this.pendingPush) await this._push();
      else this._emit('ok');
      return false;
    }

    try {
      const res = await this._request('/state');
      if (!res.ok) { this._emit('fehler', `Server antwortet ${res.status}.`); return false; }
      const body = await res.json();
      const remote = await decryptState(key.key, body.blob);
      this._adopt(remote, body);
      this._emit('ok');
      return true;
    } catch (err) {
      this._emit('fehler', this._explain(err));
      return false;
    }
  }

  _adopt(remoteState, body) {
    this.meta = { version: body.version, updatedAt: body.updatedAt };
    saveMeta(this.meta);
    this.applyingRemote = true;
    try { this.onRemoteState(remoteState); } finally { this.applyingRemote = false; }
  }

  /* ---- Schieben ---- */

  async push({ force = false } = {}) {
    if (!this.config) return false;
    if (!force && !this.pendingPush) return false;
    if (this._busy) { this.schedulePush(); return false; }
    this._busy = this._push().finally(() => { this._busy = null; });
    return this._busy;
  }

  async _push() {
    const key = await this.getKey();
    if (!key) { this._emit('gesperrt'); return false; }

    clearTimeout(this._pushTimer);
    const snapshot = JSON.parse(JSON.stringify(this.store.state));
    let blob;
    try {
      blob = await encryptState(key.key, snapshot, key.salt);
    } catch (err) {
      this._emit('fehler', this._explain(err));
      return false;
    }

    let res;
    try {
      res = await this._request('/state', {
        method: 'PUT',
        body: JSON.stringify({ baseVersion: this.meta.version, blob }),
      });
    } catch (err) {
      // Kein Netz: der lokale Stand steht, der Versuch wiederholt sich beim
      // naechsten Nachsehen.
      this._emit('offline', String(err && err.message ? err.message : err));
      return false;
    }

    if (res.status === 409) {
      const body = await res.json();
      const backup = keepConflictCopy(snapshot);
      try {
        const remote = await decryptState(key.key, body.blob);
        this._adopt(remote, body);
        this.pendingPush = false;
        this._emit('konflikt', backup
          ? 'Ein anderes Gerät war schneller. Der fremde Stand gilt; deiner liegt als Sicherung im Browser.'
          : 'Ein anderes Gerät war schneller. Der fremde Stand gilt.');
      } catch (err) {
        this._emit('fehler', this._explain(err));
      }
      return false;
    }
    if (res.status === 401) { this._emit('fehler', 'Token abgelehnt.'); return false; }
    if (!res.ok) { this._emit('fehler', `Server antwortet ${res.status}.`); return false; }

    const body = await res.json();
    this.meta = { version: body.version, updatedAt: body.updatedAt };
    saveMeta(this.meta);
    this.pendingPush = false;
    this._emit('ok');
    return true;
  }

  /* ---- Einrichten ---- */

  /** Erreichbarkeit und Token pruefen, ohne etwas zu schreiben. */
  async check(config) {
    const before = this.config;
    this.config = config;
    try {
      const res = await this._request('/version');
      if (res.status === 401) return { ok: false, error: 'Token wird abgelehnt.' };
      if (!res.ok) return { ok: false, error: `Server antwortet ${res.status}.` };
      const body = await res.json();
      return { ok: true, version: body.version, updatedAt: body.updatedAt };
    } catch (err) {
      return { ok: false, error: `Nicht erreichbar: ${err && err.message ? err.message : err}` };
    } finally {
      this.config = before;
    }
  }

  _explain(err) {
    const m = String(err && err.message ? err.message : err);
    if (/operation-specific reason|OperationError|decrypt/i.test(m)) {
      return 'Der Block lässt sich nicht entschlüsseln — andere Passphrase?';
    }
    return m;
  }

  /** Nach dem Einrichten oder Entsperren neu anlaufen lassen. */
  reconfigure(config) {
    this.stop();
    this.config = config;
    saveConfig(config);
    if (!config) { this.meta = { version: 0, updatedAt: null }; saveMeta(this.meta); this._emit('aus'); return; }
    this.start();
  }

  /** Den Stand setzen, auf dem dieses Geraet aufsetzt (beim Einrichten). */
  setVersion(version, updatedAt = null) {
    this.meta = { version: Number(version) || 0, updatedAt };
    saveMeta(this.meta);
  }

  /** Version zuruecksetzen, damit der naechste Abgleich alles neu holt. */
  forgetVersion() {
    this.meta = { version: 0, updatedAt: null };
    saveMeta(this.meta);
  }
}
