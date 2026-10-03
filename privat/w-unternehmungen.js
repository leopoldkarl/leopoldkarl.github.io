// w-unternehmungen.js — die nächsten (bis zu) drei Unternehmungen mit Link.
//
// Die Liste liegt verschlüsselt in /unternehmungen/inhalt.enc.json (gleiche
// Passphrase wie /privat, eigener AAD und eigenes Salz). Schlüssel: der dort
// gemerkte (IndexedDB „unternehmungen“), sonst direkt nach der Eingabe auf
// /privat dieselbe Passphrase; bei „merken“ wird er dort abgelegt.
// Auswahl wie auf der Seite: Ende (data-bis, sonst data-von) >= heute,
// aufsteigend nach Beginn.

import { N, zeile, hinweis, heuteIso, idbGet, idbPut, ableiten, b64 } from './kachel-util.js';

const AAD = new TextEncoder().encode('leopoldkarl.com/unternehmungen|v1');

async function entschluesseln(key, blob) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64(blob.iv), additionalData: AAD }, key, b64(blob.ct));
  return new TextDecoder().decode(pt);
}

export function naechste(html, heute = heuteIso()) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const ende = (li) => li.dataset.bis || li.dataset.von || '';
  return [...tpl.content.querySelectorAll('li[data-von]')]
    .filter((li) => ende(li) >= heute)
    .sort((a, b) => (a.dataset.von || '').localeCompare(b.dataset.von || ''))
    .slice(0, N)
    .map((li) => {
      const a = li.querySelector('a');
      return {
        href: a ? a.getAttribute('href') : '/unternehmungen/',
        titel: (li.querySelector('strong') || a || li).textContent.trim(),
        datum: (li.querySelector('.u-datum')?.textContent || '').trim(),
      };
    });
}

export async function fuellen(liste, ctx = {}) {
  let blob;
  try {
    const r = await fetch('/unternehmungen/inhalt.enc.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error();
    blob = await r.json();
  } catch { hinweis(liste, 'Unternehmungen nicht abrufbar.'); return; }

  let html = null;
  const gemerkt = await idbGet('unternehmungen', 'keys', 'v1');
  if (gemerkt) { try { html = await entschluesseln(gemerkt, blob); } catch { /* veraltet */ } }
  if (html == null && ctx.pass) {
    try {
      const k = await ableiten(ctx.pass, blob.kdf.salt, blob.kdf.iterations);
      html = await entschluesseln(k, blob);
      if (ctx.merken) await idbPut('unternehmungen', 'keys', 'v1', k);
    } catch { /* andere Passphrase */ }
  }
  if (html == null) { hinweis(liste, 'Gesperrt — in /unternehmungen entsperren.'); return; }

  const n = naechste(html);
  if (!n.length) { hinweis(liste, 'Nichts geplant.'); return; }
  liste.replaceChildren(...n.map((u) => zeile(u.href, u.titel, u.datum)));
}
