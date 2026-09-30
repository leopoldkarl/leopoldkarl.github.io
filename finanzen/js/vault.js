// vault.js — verschlüsselte lokale Ablage und gemerkter Schlüssel.
//
// Anders als /projekte liegt hier auch die LOKALE Kopie nur als Chiffrat im
// localStorage (`finanzen.vault`, dasselbe Blockformat wie beim Worker). Ohne
// Passphrase oder gemerkten Schlüssel zeigt die Seite also nichts, auch nicht
// auf einem Gerät, auf dem schon gearbeitet wurde.
//
// Schlüssel: PBKDF2-SHA-256 (600 000 It., Salz 16 B) -> AES-256-GCM, siehe
// /kalender/js/crypto.js. Die Passphrase wird vorher NFC-normalisiert, damit
// „ä“ auf jedem Gerät gleich ankommt (wie in /privat).
//
// „Auf diesem Gerät merken“: der abgeleitete, nicht exportierbare CryptoKey
// liegt in IndexedDB „finanzen“. Sperren löscht ihn.

import {
  encryptState, decryptState, deriveKey, newSalt, saltOf, iterationsOf, KDF_ITERATIONS,
} from '../../kalender/js/crypto.js';

export const VAULT_KEY = 'finanzen.vault';
export const MIN_PASSPHRASE = 12;

export const nfc = (p) => String(p ?? '').normalize('NFC');

/* ---- lokales Chiffrat ---- */

export function readVaultRaw() {
  try { return localStorage.getItem(VAULT_KEY); } catch { return null; }
}

export function readVault() {
  const raw = readVaultRaw();
  if (!raw) return null;
  try { const b = JSON.parse(raw); return b && b.ct ? b : null; } catch { return null; }
}

/** @returns {string} der geschriebene Rohtext */
export function writeVaultRaw(raw) {
  localStorage.setItem(VAULT_KEY, raw);
  return raw;
}

export async function sealState(keyObj, state) {
  return encryptState(keyObj.key, state, keyObj.salt);
}

export async function openBlob(keyObj, blob) {
  return decryptState(keyObj.key, blob);
}

/** Neuer Schlüssel mit neuem Salz (Ersteinrichtung ohne Server). */
export async function newKey(passphrase) {
  const salt = newSalt();
  const key = await deriveKey(nfc(passphrase), salt, KDF_ITERATIONS);
  return { key, salt, iterations: KDF_ITERATIONS };
}

/** Schlüssel zum Salz eines vorhandenen Blocks; wirft bei falscher Passphrase. */
export async function unlockBlob(passphrase, blob) {
  const salt = saltOf(blob);
  const iterations = iterationsOf(blob);
  const key = await deriveKey(nfc(passphrase), salt, iterations);
  const keyObj = { key, salt, iterations };
  const state = await decryptState(key, blob);   // wirft bei falscher Passphrase
  return { keyObj, state };
}

/** Gleiches Salz? (Gemerkter Schlüssel passt nur zu Blöcken mit seinem Salz.) */
export function sameSalt(keyObj, blob) {
  const s = saltOf(blob);
  if (!s || !keyObj || !keyObj.salt) return false;
  const a = new Uint8Array(keyObj.salt);
  if (a.length !== s.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== s[i]) return false;
  return true;
}

/* ---- gemerkter Schlüssel (IndexedDB) ---- */

const DB_NAME = 'finanzen';
const STORE = 'keys';
const ID = 'main';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB fehlt.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function rememberKey(keyObj) {
  const db = await openDb();
  try { await tx(db, 'readwrite', (s) => s.put({ key: keyObj.key, salt: keyObj.salt, iterations: keyObj.iterations }, ID)); }
  finally { db.close(); }
}

export async function recallKey() {
  let db;
  try { db = await openDb(); } catch { return null; }
  try { return (await tx(db, 'readonly', (s) => s.get(ID))) || null; } catch { return null; } finally { db.close(); }
}

export async function forgetKey() {
  let db;
  try { db = await openDb(); } catch { return; }
  try { await tx(db, 'readwrite', (s) => s.delete(ID)); } catch { /* egal */ } finally { db.close(); }
}
