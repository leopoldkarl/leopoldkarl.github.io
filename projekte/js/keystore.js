// keystore.js — Ablage des abgeleiteten Schluessels je Geraet.
//
// Uebernommen aus /kalender/js/keystore.js; einziger Unterschied ist der
// Name der Datenbank: Projekte haben einen eigenen Block mit eigenem Salz und
// damit einen eigenen Schluessel, auch bei gleicher Passphrase.
//
// IndexedDB statt localStorage, weil dort ein `CryptoKey` als Objekt liegen
// darf: der Rohschluessel bleibt damit fuer JavaScript unlesbar (abgeleitet
// mit `extractable: false`) und taucht in keinem Speicherabzug auf. In
// localStorage muesste man ihn als Text ablegen, also im Klartext.
//
// Folge fuers Bedienen: die Passphrase wird einmal je Geraet und Browser
// eingegeben, nicht bei jedem Laden. Wer den entsperrten Browser bedient,
// kommt an die Daten — dagegen schuetzt diese Schicht nicht und soll es auch
// nicht; sie schuetzt gegen Mitlesen auf dem Server.

const DB_NAME = 'projekte';
const DB_VERSION = 1;
const STORE = 'keys';
const ID = 'main';

function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB steht nicht zur Verfügung.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
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

/** @param {CryptoKey} key @param {Uint8Array} salt */
export async function saveKey(key, salt, iterations) {
  const db = await open();
  try {
    await tx(db, 'readwrite', (s) => s.put({ key, salt, iterations }, ID));
  } finally { db.close(); }
}

/** @returns {Promise<{key: CryptoKey, salt: Uint8Array, iterations: number}|null>} */
export async function loadKey() {
  let db;
  try { db = await open(); } catch { return null; }
  try {
    const got = await tx(db, 'readonly', (s) => s.get(ID));
    return got || null;
  } catch { return null; } finally { db.close(); }
}

export async function clearKey() {
  const db = await open();
  try { await tx(db, 'readwrite', (s) => s.delete(ID)); } finally { db.close(); }
}
