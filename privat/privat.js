// Entschluesselt inhalt.enc.json (erzeugt von build.py) im Browser.
// Format v1: PBKDF2-SHA256(Passphrase NFC, salt, iter) -> 256 bit AES-GCM,
// AAD = "leopoldkarl.com/privat|v1", Klartext = UTF-8-HTML-Fragment.
// "Merken" legt den abgeleiteten Schluessel als NICHT exportierbaren
// CryptoKey in IndexedDB ab; die Passphrase selbst wird nie gespeichert.

const AAD = new TextEncoder().encode('leopoldkarl.com/privat|v1');
const DB = 'privat', STORE = 'keys', KEYID = 'v1';
const $ = (id) => document.getElementById(id);

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function idb(mode, fn) {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction(STORE, mode);
        const r = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(r && 'result' in r ? r.result : true);
        tx.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}
const keyLaden   = () => idb('readonly',  (s) => s.get(KEYID));
const keySpeichern = (k) => idb('readwrite', (s) => s.put(k, KEYID));
const keyLoeschen  = () => idb('readwrite', (s) => s.delete(KEYID));

async function ableiten(pass, kdf) {
  const base = await crypto.subtle.importKey('raw',
    new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(kdf.salt), iterations: kdf.iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function entschluesseln(key, blob) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64(blob.iv), additionalData: AAD }, key, b64(blob.ct));
  return new TextDecoder().decode(pt);
}

function zeigen(html) {
  $('sperre').hidden = true;
  $('inhalt').innerHTML = html;   // authentifiziert durch GCM-Tag, stammt von build.py
  $('inhalt').hidden = false;
  $('sperren-wrap').hidden = false;
}

function sperren() {
  keyLoeschen();
  $('inhalt').innerHTML = '';
  $('inhalt').hidden = true;
  $('sperren-wrap').hidden = true;
  $('sperre').hidden = false;
  $('pw').value = '';
  $('pw').focus();
}

async function main() {
  if (!window.isSecureContext || !crypto.subtle) {
    $('sperre').hidden = false;
    $('meldung').textContent = 'WebCrypto nicht verfügbar (nur über HTTPS).';
    $('go').disabled = true;
    return;
  }
  let blob;
  try {
    const r = await fetch('./inhalt.enc.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    blob = await r.json();
    if (blob.v !== 1) throw new Error('Version');
  } catch {
    $('sperre').hidden = false;
    $('meldung').textContent = 'Inhalt konnte nicht geladen werden.';
    $('go').disabled = true;
    return;
  }

  const gemerkt = await keyLaden();
  if (gemerkt) {
    try { return zeigen(await entschluesseln(gemerkt, blob)); }
    catch { await keyLoeschen(); }   // Inhalt neu verschluesselt -> Schluessel veraltet
  }
  $('sperre').hidden = false;
  $('pw').focus();

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('meldung');
    $('go').disabled = true;
    m.className = 'meldung info';
    m.textContent = 'Prüfe …';
    try {
      const key = await ableiten($('pw').value, blob.kdf);
      const html = await entschluesseln(key, blob);
      if ($('merken').checked) await keySpeichern(key);
      m.textContent = '';
      zeigen(html);
    } catch {
      m.className = 'meldung';
      m.textContent = 'Falsche Passphrase.';
      $('pw').select();
    } finally {
      $('go').disabled = false;
    }
  });
}

$('sperren').addEventListener('click', sperren);
main();
