// crypto.js — clientseitige Verschluesselung des Zustands.
//
// Modell: der Server (Cloudflare Worker + D1) speichert einen undurchsichtigen
// Block. Der Schluessel wird aus einer Passphrase abgeleitet und verlaesst den
// Browser nie. Wer den Speicher liest — Cloudflare, ein Angreifer mit dem
// API-Token, ich — sieht Chiffrat.
//
// Was das NICHT leistet, damit die Erwartung stimmt:
//   * Kein Schutz gegen jemanden, der den Browser bedient. Dort liegt der
//     abgeleitete Schluessel (nicht exportierbar) in IndexedDB, damit man die
//     Passphrase nicht bei jedem Laden neu tippen muss.
//   * Keine Integritaet gegen Ruecksetzen: der Server kann eine aeltere, gueltig
//     signierte Fassung ausliefern. AES-GCM erkennt Verfaelschung, nicht Alter.
//   * Passphrase vergessen heisst Daten weg. Es gibt keine Hintertuer.
//
// Parameter: PBKDF2-HMAC-SHA-256, 600 000 Iterationen (OWASP-Empfehlung fuer
// PBKDF2-SHA-256, Stand 2023 — nachpruefen, wenn das hier laenger steht),
// 16 Byte Salz, AES-256-GCM mit 12-Byte-IV. Das Salz liegt beim Chiffrat; es
// ist kein Geheimnis, es verhindert vorberechnete Tabellen.

export const KDF_ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
export const BLOB_VERSION = 1;

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('WebCrypto steht nicht zur Verfügung (braucht HTTPS oder localhost).');
  }
  return c.subtle;
};

/* ------------------------------------------------------------------ */
/* Base64 ohne Umweg über Strings mit Sonderzeichen                    */
/* ------------------------------------------------------------------ */

export function toB64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  // In Bloecken, sonst sprengt ein grosser Zustand den Argumentstapel.
  const step = 0x8000;
  for (let i = 0; i < b.length; i += step) s += String.fromCharCode(...b.subarray(i, i + step));
  return btoa(s);
}

export function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export const newSalt = () => randomBytes(SALT_BYTES);

/* ------------------------------------------------------------------ */
/* Schlüssel                                                           */
/* ------------------------------------------------------------------ */

/**
 * Leitet den AES-GCM-Schluessel aus der Passphrase ab.
 *
 * `extractable: false` — der Rohschluessel ist danach aus JavaScript heraus
 * nicht mehr lesbar; das Objekt laesst sich aber in IndexedDB ablegen, was
 * genau die gewuenschte Mischung ergibt: einmal tippen je Geraet, und kein
 * Rohschluessel, der in einem Speicherabzug auftaucht.
 */
export async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const material = await subtle().importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ------------------------------------------------------------------ */
/* Nutzdaten                                                           */
/* ------------------------------------------------------------------ */

/**
 * Verschluesselt ein Objekt. Rueckgabe ist der Block, wie er beim Server
 * liegt: JSON, in dem alles Binaere Base64 ist.
 *
 * Fuer jede Verschluesselung ein frischer IV. Bei AES-GCM ist ein
 * wiederverwendeter IV mit demselben Schluessel kein Schoenheitsfehler,
 * sondern bricht die Vertraulichkeit.
 */
export async function encryptState(key, state, salt) {
  const iv = randomBytes(IV_BYTES);
  const plain = new TextEncoder().encode(JSON.stringify(state));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    v: BLOB_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: toB64(salt) },
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

/**
 * Entschluesselt einen Block. Wirft bei falscher Passphrase oder verfaelschten
 * Daten — AES-GCM unterscheidet beides nicht, und das ist richtig so.
 */
export async function decryptState(key, blob) {
  if (!blob || blob.v !== BLOB_VERSION) throw new Error('Unbekanntes Blockformat.');
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ct),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Das Salz aus einem vorhandenen Block, um denselben Schluessel abzuleiten. */
export function saltOf(blob) {
  if (!blob || !blob.kdf || !blob.kdf.salt) return null;
  return fromB64(blob.kdf.salt);
}

/** Iterationszahl eines Blocks — aeltere Bloecke koennen weniger haben. */
export function iterationsOf(blob) {
  return (blob && blob.kdf && Number(blob.kdf.iterations)) || KDF_ITERATIONS;
}
