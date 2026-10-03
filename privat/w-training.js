// w-training.js — die letzten drei Aktivitäten, je als Link auf /training/#/a/<id>.
//
// Liest training/data/index.bin selbst (source.js aus /training löst seine
// Pfade relativ zur Seite auf und taugt hier nicht). Schlüssel: der in
// /training gemerkte (IndexedDB „training-keys“, Eintrag k:<salt>); sonst,
// direkt nach der Passphrase-Eingabe auf /privat, ein Versuch mit derselben
// Passphrase — bei Erfolg und „merken“ wird er dort auch abgelegt.

import { N, zeile, hinweis, tagMonat, idbGet, idbPut, ableiten } from './kachel-util.js';

const DATA = '/training/data/';
const enc = new TextEncoder();

async function gunzipJSON(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(s).text());
}

async function index(key) {
  const r = await fetch(`${DATA}index.bin`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const magic = String.fromCharCode(...buf.subarray(0, 4));
  if (magic === 'LKT0') return gunzipJSON(buf.subarray(4));
  if (magic !== 'LKT1' || !key) throw new Error('gesperrt');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.subarray(4, 16), additionalData: enc.encode('LKT1|index') },
    key, buf.subarray(16));
  return gunzipJSON(new Uint8Array(plain));
}

function meta(a) {
  const teile = [tagMonat(a.start)];
  if (a.dist) teile.push(`${(a.dist / 1000).toLocaleString('de-AT', { maximumFractionDigits: a.dist >= 100000 ? 0 : 1 })} km`);
  else if (a.moving) {
    const m = Math.round(a.moving / 60);
    teile.push(m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h` : `${m} min`);
  }
  return teile.join(' · ');
}

export async function fuellen(liste, ctx = {}) {
  let manifest;
  try {
    const r = await fetch(`${DATA}manifest.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error();
    manifest = await r.json();
  } catch { hinweis(liste, 'Noch keine Trainingsdaten.'); return; }

  let idx = null;
  if (manifest.mode === 'encrypted') {
    const id = `k:${manifest.kdf.salt}`;
    const gemerkt = await idbGet('training-keys', 'keys', id);
    if (gemerkt) { try { idx = await index(gemerkt); } catch { /* veraltet */ } }
    if (!idx && ctx.pass) {
      try {
        const k = await ableiten(ctx.pass, manifest.kdf.salt, manifest.kdf.iterations);
        idx = await index(k);
        if (ctx.merken) await idbPut('training-keys', 'keys', id, k);
      } catch { /* andere Passphrase */ }
    }
    if (!idx) { hinweis(liste, 'Gesperrt — in /training entsperren.'); return; }
  } else {
    try { idx = await index(null); } catch { hinweis(liste, 'Trainingsdaten nicht lesbar.'); return; }
  }

  const acts = [...(idx.activities || [])]
    .sort((a, b) => String(b.start).localeCompare(String(a.start)))
    .slice(0, N);
  if (!acts.length) { hinweis(liste, 'Noch keine Aktivitäten.'); return; }
  liste.replaceChildren(...acts.map((a) =>
    zeile(`/training/#/a/${encodeURIComponent(a.id)}`, a.name || 'Aktivität', meta(a))));
}
