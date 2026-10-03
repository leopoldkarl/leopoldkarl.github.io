// kachel-util.js — gemeinsame Bausteine der Kacheln auf /privat.

export const N = 3;

const pad = (n) => String(n).padStart(2, '0');
export const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** 'YYYY-MM-DD…' -> '3.10.' */
export const tagMonat = (iso) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

export const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
export { el };

/** Eine Zeile: Link + optionale Kurzangabe dahinter. */
export function zeile(href, text, meta, { metaCls = '', title = '' } = {}) {
  const z = el('div', 'tl-z');
  const a = el('a', null, text);
  a.href = href;
  if (title) a.title = title;
  z.append(a);
  if (meta) z.append(el('span', `tl-m ${metaCls}`.trim(), meta));
  return z;
}

export function hinweis(liste, text) {
  liste.replaceChildren(el('div', 'tl-hinweis', text));
}

/* ---- IndexedDB (fremde Datenbanken derselben Herkunft, je ein Store) ---- */

function oeffnen(db, store) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('keine IndexedDB')); return; }
    const req = indexedDB.open(db, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(db, store, id) {
  try {
    const d = await oeffnen(db, store);
    return await new Promise((resolve) => {
      try {
        const r = d.transaction(store, 'readonly').objectStore(store).get(id);
        r.onsuccess = () => { d.close(); resolve(r.result ?? null); };
        r.onerror = () => { d.close(); resolve(null); };
      } catch { d.close(); resolve(null); }
    });
  } catch { return null; }
}

export async function idbPut(db, store, id, value) {
  try {
    const d = await oeffnen(db, store);
    await new Promise((resolve) => {
      const t = d.transaction(store, 'readwrite');
      t.objectStore(store).put(value, id);
      t.oncomplete = t.onerror = t.onabort = () => { d.close(); resolve(); };
    });
  } catch { /* egal */ }
}

/** PBKDF2-SHA256 (NFC) -> nicht exportierbarer AES-GCM-Schlüssel zum Entschlüsseln. */
export async function ableiten(pass, saltB64, iterations) {
  const base = await crypto.subtle.importKey('raw',
    new TextEncoder().encode(String(pass).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(saltB64), iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
