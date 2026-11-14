// ss.js — SS („Simple and Stupid"): je Tag dieselben acht Felder.
//
// Bewusst ohne alles, was die anderen Seiten koennen: keine Uhrzeiten,
// keine Termine, kein Ziehen. Ein Feld ist ein Freitext und eine Zahl
// (investierte Stunden). Was im Feld vorgeschlagen ist (Bezeichnung und
// Richtwert), steht nur als Platzhalter da und verschwindet, sobald man
// etwas eintraegt.

import { el } from './views.js';
import { WEEKDAY_SHORT, isoDow, sameDay, ymd } from './dates.js';

/**
 * Die Felder in der Reihenfolge der Skizze (seit 14.11.2026 Forschung vor
 * Paper; die Eintraege wandern mit, weil sie an der ID haengen). Die IDs sind
 * Speicherschluessel:
 * nicht umbenennen, sonst haengen alte Eintraege an nichts mehr. Neue Felder
 * einfach dazuschreiben, Bezeichnungen und Richtwerte frei aenderbar.
 */
export const SS_FELDER = [
  { id: 'sonstiges',  label: 'Sonstiges' },
  { id: 'mr',         label: 'MR inkl. T1 & L1', soll: '~2–3 h' },
  { id: 'forschung1', label: 'Forschung',        soll: '~2 h' },
  { id: 'paper',      label: 'Paper',            soll: '~2 h' },
  { id: 'mp',         label: 'MP inkl. K/L' },
  { id: 'lektuere',   label: 'Lektüre',          soll: '~2 h' },
  { id: 'forschung2', label: 'Forschung',        soll: '~2 h' },
  { id: 'ar',         label: 'AR inkl. T2',      soll: '~2 h' },
];

/**
 * Stunden lesen: „1,5", „1.5", „1:30" (Stunden:Minuten), „90min" bzw.
 * „90 m" (Minuten). Leer = 0. Liefert `null`, wenn nichts davon passt.
 */
export function parseStunden(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, '').toLowerCase();
  if (!t) return 0;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(\d+(?:[.,]\d+)?)(?:min|m)$/.exec(t);
  if (m) return Number(m[1].replace(',', '.')) / 60;
  m = /^(\d+(?:[.,]\d+)?)h?$/.exec(t);
  if (m) return Number(m[1].replace(',', '.'));
  return null;
}

/** 1.5 → „1,5"; ganze Zahlen ohne Komma, hoechstens zwei Nachkommastellen. */
export function fmtStunden(h) {
  if (!(h > 0)) return '0';
  const r = Math.round(h * 100) / 100;
  return String(r).replace('.', ',');
}

export function tagesSumme(tag) {
  return Object.values(tag || {}).reduce((s, f) => s + (Number(f.h) || 0), 0);
}

function feld(def, wert, key, { kompakt }) {
  const box = el('div', 'ss-box');
  box.dataset.ssfeld = def.id;
  if (wert.text || wert.h) box.classList.add('belegt');

  const ta = document.createElement('textarea');
  ta.className = 'ss-text';
  ta.rows = kompakt ? 2 : 3;
  ta.value = wert.text || '';
  // Zeilenumbruch im Platzhalter: Bezeichnung oben, Richtwert darunter, wie
  // auf dem Papier.
  ta.placeholder = def.soll ? `${def.label}\n${def.soll}` : def.label;
  ta.dataset.ssday = key;
  ta.dataset.ssslot = def.id;
  ta.dataset.sspart = 'text';
  ta.setAttribute('aria-label', `${def.label} am ${key}`);
  ta.spellcheck = false;

  const fuss = el('label', 'ss-h');
  const h = document.createElement('input');
  h.type = 'text';
  h.inputMode = 'decimal';
  h.autocomplete = 'off';
  h.className = 'ss-hin';
  h.value = wert.h ? fmtStunden(wert.h) : '';
  h.placeholder = '–';
  h.dataset.ssday = key;
  h.dataset.ssslot = def.id;
  h.dataset.sspart = 'h';
  h.setAttribute('aria-label', `Investierte Stunden ${def.label} am ${key}`);
  fuss.append(h, el('span', 'ss-hu', 'h'));

  box.append(ta, fuss);
  return box;
}

function kopf(tag, key, summe, { heute, gewaehlt }) {
  const head = el('div', 'ss-head');
  head.dataset.sskey = key;
  if (heute) head.classList.add('today');
  if (gewaehlt) head.classList.add('selected');
  const t = el('div', 'pl-col-title');
  t.dataset.ssgoto = key;
  t.append(el('span', 'dow', WEEKDAY_SHORT[isoDow(tag)]));
  t.append(el('span', 'num', String(tag.getDate())));
  head.append(t);
  const s = el('div', 'ss-sum', summe ? `${fmtStunden(summe)} h` : '');
  s.dataset.sssum = key;
  head.append(s);
  return head;
}

/**
 * @param {object} ctx
 * @param {'day'|'week'} ctx.ansicht
 * @param {Date[]} ctx.days        ein Tag (day) oder sieben (week)
 * @param {(ymd: string) => object} ctx.tagFor
 * @param {string} ctx.selected
 * @param {Date} ctx.today
 */
export function renderSS(ctx) {
  const woche = ctx.ansicht === 'week';
  const root = el('div', `ss-page ${woche ? 'week' : 'day'}`);

  const summen = ctx.days.map((d) => tagesSumme(ctx.tagFor(ymd(d))));
  const gesamt = summen.reduce((a, b) => a + b, 0);
  const bar = el('div', 'pl-bar');
  const st = el('span', 'pl-state', woche
    ? `${fmtStunden(gesamt)} h investiert in dieser Woche`
    : `${fmtStunden(gesamt)} h investiert`);
  st.dataset.sstotal = '';
  bar.append(st);
  root.append(bar);

  // Ein Raster mit einer Zeile je Feld: so stehen gleiche Felder der Woche
  // nebeneinander, und eine Zeile ist so hoch wie ihr laengster Eintrag.
  const grid = el('div', 'ss-grid');
  grid.dataset.ssgrid = ctx.ansicht;
  grid.style.setProperty('--tage', String(ctx.days.length));

  if (woche) {
    // Linke Randspalte: in der Woche verschwinden die Platzhalter in den
    // gefuellten Feldern, die Zeile sagt dann trotzdem noch, was sie ist.
    grid.append(el('div', 'ss-corner'));
  }
  ctx.days.forEach((d, i) => {
    const key = ymd(d);
    grid.append(kopf(d, key, summen[i], {
      heute: sameDay(d, ctx.today), gewaehlt: woche && key === ctx.selected,
    }));
  });

  for (const def of SS_FELDER) {
    if (woche) {
      const summe = ctx.days.reduce((s, d) => s + (Number(ctx.tagFor(ymd(d))[def.id]?.h) || 0), 0);
      const lab = el('div', 'ss-rowlabel');
      lab.append(el('span', 'ss-rowname', def.label));
      const z = el('span', 'ss-rowsum', summe ? `${fmtStunden(summe)} h` : (def.soll || ''));
      z.dataset.ssrowsum = def.id;
      if (!summe) z.classList.add('soll');
      lab.append(z);
      grid.append(lab);
    }
    for (const d of ctx.days) {
      const key = ymd(d);
      grid.append(feld(def, ctx.tagFor(key)[def.id] || {}, key, { kompakt: woche }));
    }
  }
  root.append(grid);
  return root;
}
