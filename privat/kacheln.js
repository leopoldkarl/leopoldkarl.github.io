// kacheln.js — macht aus den Kacheln der entschlüsselten Linkliste Kacheln
// mit Kopf-Link und bis zu drei Einträgen darunter.
//
// Die Linkliste (quelle.html) enthält je Kachel <a class="tile" href><strong>.
// Links in Links sind nicht erlaubt, daher wird jede Kachel zu
//   <div class="tile"><a class="tile-kopf" href>Titel</a><div class="tl-liste">…</div></div>
// umgebaut; Beschreibungstexte entfallen. Die Einträge liefern die Module je
// Ziel. Ein Fehler in einem Modul lässt die übrigen Kacheln unberührt.

import { hinweis } from './kachel-util.js';

const MODULE = {
  '/kalender/': () => import('./w-kalender.js'),
  '/training/': () => import('./w-training.js'),
  '/projekte/': () => import('./projekte-top.js'),
  '/finanzen/': () => import('./w-finanzen.js'),
  '/unternehmungen/': () => import('./w-unternehmungen.js'),
};

/**
 * @param {HTMLElement} root
 * @param {{pass?: string|null, merken?: boolean}} ctx  Passphrase nur direkt
 *   nach der Eingabe (zum Mit-Entsperren von Seiten mit derselben Passphrase),
 *   wird nirgends abgelegt.
 */
export function aufbauen(root, ctx = {}) {
  for (const a of root.querySelectorAll('.tile-grid > a.tile')) {
    const href = a.getAttribute('href');
    const titel = (a.querySelector('strong') || a).textContent.trim();
    const kachel = document.createElement('div');
    kachel.className = 'tile';
    const kopf = document.createElement('a');
    kopf.className = 'tile-kopf';
    kopf.href = href;
    kopf.textContent = titel;
    const liste = document.createElement('div');
    liste.className = 'tl-liste';
    kachel.append(kopf, liste);
    a.replaceWith(kachel);
    const lade = MODULE[href];
    if (!lade) continue;
    lade()
      .then((m) => m.fuellen(liste, ctx))
      .catch(() => hinweis(liste, 'Konnte nicht geladen werden.'));
  }
}
