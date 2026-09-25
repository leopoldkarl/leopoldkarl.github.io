// tooltip.js — voller Text beim Verweilen mit dem Zeiger.
//
// Warum nicht das `title`-Attribut: dessen Verzoegerung ist nicht einstellbar
// (rund eine Sekunde), es laesst sich nicht gestalten, und auf einem
// `<input>` — so sind die Titel in der Planung umgesetzt — zeigt es den Wert
// gar nicht an, sondern nur, was im Attribut steht.
//
// Gezeigt wird nur, was nicht ohnehin lesbar ist: passt der Text in sein
// Element, passiert nichts. Sonst waere jeder Zeigerweg ueber den Kalender
// ein Flackern von Kaesten.

const DEFAULT_DELAY = 350;

let tipEl = null;
let timer = null;
let anchor = null;          // Element, ueber dem der Zeiger steht
let entries = [];

function ensureEl() {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.append(tipEl);
  return tipEl;
}

/** Der sichtbare Text eines Ziels: bei Eingabefeldern der aktuelle Wert. */
export function textOf(node) {
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node.value;
  if (node.dataset && node.dataset.tip) return node.dataset.tip;
  return (node.textContent || '').trim();
}

/**
 * Wird der Text abgeschnitten? Deckt beide Faelle ab: seitlich (ellipsis,
 * `white-space: nowrap`) und in der Hoehe (Kasten zu flach fuer die Zeilen).
 * Ein Pixel Toleranz, weil Unterlaengen und Subpixel-Layout sonst bei
 * vollstaendig sichtbarem Text anschlagen.
 */
export function isClipped(node) {
  return node.scrollWidth > node.clientWidth + 1
    || node.scrollHeight > node.clientHeight + 1;
}

function hide() {
  clearTimeout(timer);
  timer = null;
  anchor = null;
  if (tipEl) { tipEl.hidden = true; tipEl.textContent = ''; }
}

export const hideTip = hide;

function place(labelNode) {
  const el = ensureEl();
  const r = labelNode.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  const margin = 6;
  let top = r.top - t.height - margin;
  if (top < margin) top = Math.min(r.bottom + margin, window.innerHeight - t.height - margin);
  let left = r.left + (r.width - t.width) / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - t.width - margin));
  el.style.top = `${Math.max(margin, top)}px`;
  el.style.left = `${left}px`;
}

function show(target, labelNode) {
  const text = textOf(labelNode);
  if (!text) return;
  const el = ensureEl();
  el.textContent = text;
  el.hidden = false;
  // Erst messen, wenn der Text drin steht, sonst stimmt die Hoehe nicht.
  place(labelNode);
  anchor = target;
}

function match(node) {
  for (const e of entries) {
    const target = node.closest(e.match);
    if (!target) continue;
    const label = e.label ? target.querySelector(e.label) : target;
    if (label) return { target, label };
  }
  return null;
}

/**
 * @param {Array<{match: string, label?: string}>} targets
 *   `match` waehlt das Element unter dem Zeiger, `label` das darin liegende
 *   Element, dessen Text abgeschnitten sein kann (fehlt es, ist es dasselbe).
 */
export function initTooltips(targets, { delay = DEFAULT_DELAY } = {}) {
  entries = targets;

  document.addEventListener('pointerover', (e) => {
    // Nur Zeigegeraete mit echtem Hover. Auf dem Touchscreen gibt es kein
    // Verweilen ohne Beruehrung; dort waere der Kasten nur im Weg.
    if (e.pointerType === 'touch') return;
    const hit = match(e.target);
    if (!hit) { if (anchor) hide(); return; }
    if (hit.target === anchor) return;
    hide();
    // Waehrend einer laufenden Geste nichts einblenden.
    if (document.querySelector('.dragging, .pl-dragging, .tk-dragging')) return;
    if (!isClipped(hit.label)) return;
    timer = setTimeout(() => show(hit.target, hit.label), delay);
  });

  document.addEventListener('pointerout', (e) => {
    if (!anchor && !timer) return;
    const hit = match(e.target);
    if (hit && hit.target === anchor && e.relatedTarget && hit.target.contains(e.relatedTarget)) return;
    hide();
  });

  for (const ev of ['pointerdown', 'wheel', 'keydown']) {
    document.addEventListener(ev, hide, { passive: true });
  }
  // Beim Scrollen wandert der Anker weg — auch in inneren Scrollbereichen,
  // deshalb in der Erfassungsphase.
  document.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
}
