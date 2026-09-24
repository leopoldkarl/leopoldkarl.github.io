// source.js — Datenquelle.
//
// Liest die vom Sync-Skript erzeugten Dateien unter ./data/:
//   manifest.json   Klartext: Format, Modus, KDF-Parameter (kein Inhalt)
//   index.bin       alle Aktivitaets-Zusammenfassungen + Schwellenwerte
//   a/<name>.bin    Detaildaten je Aktivitaet
//
// Jede .bin-Datei beginnt mit 4 Byte Kennung:
//   "LKT0" + gzip(JSON)                          Klartext (Server mit Login)
//   "LKT1" + nonce(12) + AES-GCM(gzip(JSON))     verschluesselt
// Associated Data bei AES-GCM ist "LKT1|<Dateiname ohne .bin>", damit sich
// Dateien nicht unbemerkt vertauschen lassen.
//
// Der Schluessel wird per PBKDF2-SHA256 aus der Passphrase abgeleitet und
// optional als NICHT exportierbarer CryptoKey in IndexedDB gehalten: das
// Rohmaterial ist danach auch fuer Skripte auf dieser Seite nicht mehr
// auslesbar, nur noch benutzbar.

const DATA = new URL('./data/', document.baseURI);
const DB_NAME = 'training-keys';
const enc = new TextEncoder();

export class LockedError extends Error {}
export class NoDataError extends Error {}
export class WrongPassphraseError extends Error {}

let manifest = null;
let key = null;             // CryptoKey | null
const detailCache = new Map();

export async function loadManifest() {
  if (manifest) return manifest;
  let res;
  try {
    res = await fetch(new URL('manifest.json', DATA), { cache: 'no-cache' });
  } catch (e) {
    throw new NoDataError('Netzwerkfehler beim Laden der Daten.');
  }
  if (res.status === 404) throw new NoDataError('Noch keine Daten vorhanden.');
  if (!res.ok) throw new NoDataError(`Daten nicht abrufbar (HTTP ${res.status}).`);
  manifest = await res.json();
  if (manifest.format !== 'lkt-training') throw new NoDataError('Unbekanntes Datenformat.');
  return manifest;
}

export function isEncrypted() {
  return manifest?.mode === 'encrypted';
}

// ---------------------------------------------------------------- Schluessel

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', mode);
    const req = fn(tx.objectStore('keys'));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function keyId() {
  // an Salt gebunden: nach einem Schluesselwechsel greift der alte nicht mehr
  return `k:${manifest.kdf.salt}`;
}

export async function restoreKey() {
  if (!isEncrypted()) return true;
  if (key) return true;
  try {
    const k = await idbDo('readonly', s => s.get(keyId()));
    if (k) { key = k; return true; }
  } catch { /* privater Modus o.ae.: dann eben jedes Mal eingeben */ }
  return false;
}

export async function unlock(passphrase, remember) {
  const { iterations, salt } = manifest.kdf;
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')),
    'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(salt), iterations }, base, 512));
  const k = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['decrypt']);
  bits.fill(0);
  const prev = key;
  key = k;
  try {
    await loadIndex(true);
  } catch (e) {
    key = prev;
    if (e instanceof WrongPassphraseError) throw e;
    throw e;
  }
  if (remember) {
    try { await idbDo('readwrite', s => s.put(k, keyId())); } catch { /* ignorieren */ }
  }
}

export async function forgetKey() {
  key = null;
  indexCache = null;
  detailCache.clear();
  try { await idbDo('readwrite', s => s.clear()); } catch { /* ignorieren */ }
}

// ---------------------------------------------------------------- Dateien

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzipJSON(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

async function fetchBin(path, name) {
  const res = await fetch(new URL(path, DATA), { cache: 'no-cache' });
  if (!res.ok) throw new NoDataError(`${path}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const magic = String.fromCharCode(...buf.subarray(0, 4));
  if (magic === 'LKT0') return gunzipJSON(buf.subarray(4));
  if (magic !== 'LKT1') throw new NoDataError(`${path}: unbekanntes Format`);
  if (!key) throw new LockedError();
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.subarray(4, 16), additionalData: enc.encode(`LKT1|${name}`) },
      key, buf.subarray(16));
  } catch {
    throw new WrongPassphraseError('Entschluesselung fehlgeschlagen.');
  }
  return gunzipJSON(new Uint8Array(plain));
}

let indexCache = null;

export async function loadIndex(force = false) {
  if (indexCache && !force) return indexCache;
  await loadManifest();
  if (isEncrypted() && !key) throw new LockedError();
  indexCache = await fetchBin('index.bin', 'index');
  return indexCache;
}

export async function loadDetail(file) {
  if (detailCache.has(file)) return detailCache.get(file);
  const p = fetchBin(`a/${file}.bin`, file);
  detailCache.set(file, p);
  try {
    return await p;
  } catch (e) {
    detailCache.delete(file);
    throw e;
  }
}
