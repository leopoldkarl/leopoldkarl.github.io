// trainingsplan.js — Wochenraster fuer die Trainingseinheiten.
//
// Wie der Matheplan arbeitet diese Seite auf echten Kalenderterminen
// (`plan.kind === 'training'`), ergaenzt um Sportart, Intensitaet und
// optional Kilometer. Das Ist kommt aus den tatsaechlichen Aktivitaeten der
// Trainingsseite (trainingquelle.js) und wird nirgends gespeichert: es ist
// abgeleitet und wuerde als Kopie nur veralten.

import { el } from './views.js';
import { WEEKDAY_SHORT, isoDow, sameDay, ymd } from './dates.js';
import { SPORTS, SPORT_LABEL, INTENSITIES } from './store.js';

const pad2 = (n) => String(n).padStart(2, '0');
const INT_LABEL = { locker: 'locker', schwelle: 'Schwelle', hart: 'hart' };

/**
 * Kann der Browser Textfelder selbst auf ihren Inhalt bringen
 * (`field-sizing: content`)? Dann waechst das Feld mit jedem Zeichen, jedem
 * Umbruch, jeder Breitenaenderung und jedem nachgeladenen Schriftschnitt
 * mit, ohne dass hier gemessen wird. Sonst misst fitTitles/fitSsTexte.
 */
export const AUTOHOEHE = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('field-sizing', 'content');

/** Mehrzeilige Titelfelder auf ihren Inhalt bringen (nach dem Einhaengen). */
export function fitTitles(root) {
  for (const t of root.querySelectorAll('textarea.pl-wrap')) {
    if (AUTOHOEHE) { t.style.height = ''; continue; }
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }
}

export function dauerMin(ev) {
  if (ev.allDay) return 0;
  const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, min(String(ev.end).slice(11, 16)) - min(String(ev.start).slice(11, 16)));
}

export function fmtDauer(min) {
  if (!min) return '0:00';
  return `${Math.floor(min / 60)}:${pad2(min % 60)}`;
}

function einheit(ev) {
  const p = ev.plan || {};
  const node = el('div', `pl tr-unit tr-${p.sport || 'other'}`);
  node.dataset.tr = ev.id;

  const handle = el('span', 'pl-handle', '⠿');
  handle.setAttribute('aria-hidden', 'true');
  handle.title = 'Ziehen ändert Tag und Reihenfolge';

  const meta = el('div', 'tr-meta');
  const sport = document.createElement('select');
  sport.className = 'tr-sport';
  sport.dataset.tr = ev.id;
  sport.dataset.trfield = 'sport';
  sport.setAttribute('aria-label', 'Sportart');
  for (const s of SPORTS) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = SPORT_LABEL[s];
    if ((p.sport || 'other') === s) o.selected = true;
    sport.append(o);
  }
  const zeit = document.createElement('input');
  zeit.type = 'text';
  zeit.className = 'pl-time';
  zeit.value = ev.allDay ? '' : String(ev.start).slice(11, 16);
  zeit.placeholder = '–';
  zeit.autocomplete = 'off';
  zeit.inputMode = 'numeric';
  zeit.dataset.tr = ev.id;
  zeit.dataset.trfield = 'start';
  zeit.setAttribute('aria-label', 'Beginn');
  meta.append(sport, zeit);

  const del = el('button', 'pl-del', '×');
  del.type = 'button';
  del.dataset.trdel = ev.id;
  del.setAttribute('aria-label', `„${ev.title}“ löschen`);

  // Mehrzeilig: in sieben Spalten neben der Aufgabenliste waere ein
  // einzeiliges Feld nach zehn Zeichen zu Ende. Hoehe setzt fitTitles().
  const titel = document.createElement('textarea');
  titel.rows = 1;
  titel.className = 'pl-title pl-wrap';
  titel.spellcheck = false;
  titel.value = ev.title;
  titel.autocomplete = 'off';
  titel.dataset.tr = ev.id;
  titel.dataset.trfield = 'title';
  titel.setAttribute('aria-label', 'Bezeichnung');

  // Zahlen mit Einheit dahinter: „60 min · 12 km“ liest sich wie notiert.
  const zahlen = el('div', 'tr-zahlen');
  const zahl = (feld, wert, einheit, label, mode) => {
    const i = document.createElement('input');
    i.type = 'text';
    i.className = 'tr-num';
    i.value = wert;
    i.placeholder = '–';
    i.autocomplete = 'off';
    i.inputMode = mode;
    i.dataset.tr = ev.id;
    i.dataset.trfield = feld;
    i.setAttribute('aria-label', label);
    const wrap = el('label', 'tr-numwrap');
    wrap.append(i, el('span', 'tr-unit-label', einheit));
    return wrap;
  };
  zahlen.append(zahl('dauer', String(dauerMin(ev) || ''), 'min', 'Dauer in Minuten', 'numeric'));
  // Kilometer ergeben beim Krafttraining keinen Sinn.
  if (p.sport !== 'strength') zahlen.append(zahl('km', p.km ? String(p.km) : '', 'km', 'Kilometer', 'decimal'));

  const int = el('div', 'tr-int');
  int.setAttribute('role', 'group');
  int.setAttribute('aria-label', 'Intensität');
  for (const i of INTENSITIES) {
    const b = el('button', `tr-intbtn${p.intensity === i ? ' on' : ''}`);
    // Lang und kurz: welche Form sichtbar ist, entscheidet die Spaltenbreite.
    b.append(el('span', 'tr-lang', INT_LABEL[i]), el('span', 'tr-kurz', INT_LABEL[i][0].toUpperCase()));
    b.type = 'button';
    b.dataset.tr = ev.id;
    b.dataset.trint = i;
    b.title = `Intensität ${INT_LABEL[i]} — nochmals klicken hebt sie auf`;
    b.setAttribute('aria-pressed', String(p.intensity === i));
    int.append(b);
  }

  node.append(handle, titel, del, meta, zahlen, int);
  return node;
}

function spalte(tag, einheiten, { heute, gewaehlt, ist }) {
  const key = ymd(tag);
  const col = el('section', 'pl-col');
  col.dataset.trkey = key;
  if (heute) col.classList.add('today');
  if (gewaehlt) col.classList.add('selected');

  const head = el('div', 'pl-head');
  const titel = el('div', 'pl-col-title');
  titel.dataset.trgoto = key;
  titel.append(el('span', 'dow', WEEKDAY_SHORT[isoDow(tag)]));
  titel.append(el('span', 'num', String(tag.getDate())));
  head.append(titel);
  const min = einheiten.reduce((s, ev) => s + dauerMin(ev), 0);
  head.append(el('div', 'pl-count', min ? fmtDauer(min) : ''));
  col.append(head);

  const list = el('div', 'pl-list');
  list.dataset.trkey = key;
  for (const ev of einheiten) list.append(einheit(ev));
  if (!einheiten.length) list.append(el('p', 'empty', 'Nichts geplant.'));
  col.append(list);

  if (ist && ist.length) {
    const box = el('div', 'tr-ist');
    for (const a of ist) {
      const row = el('div', `tr-istrow tr-${a.sport}`);
      row.append(el('span', 'tr-istsport', SPORT_LABEL[a.sport]));
      row.append(el('span', 'tr-istwert', `${a.min} min${a.km ? ` · ${a.km} km` : ''}`));
      row.title = a.titel || 'Tatsächliche Aktivität von der Trainingsseite';
      box.append(row);
    }
    col.append(box);
  }

  const form = el('form', 'pl-add');
  form.dataset.trkey = key;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Einheit…';
  input.autocomplete = 'off';
  input.dataset.tradd = key;
  input.setAttribute('aria-label', `Neue Einheit am ${key}`);
  const add = el('button', 'primary', '+');
  add.type = 'submit';
  add.setAttribute('aria-label', 'Einheit anlegen');
  form.append(input, add);
  col.append(form);
  return col;
}

function kachel(sport, { plan, ist, ziel }) {
  const box = el('div', `tr-kachel tr-${sport}`);
  const top = el('div', 'tr-kachel-kopf');
  top.append(el('span', 'tr-kachel-top', SPORT_LABEL[sport]));
  top.append(el('span', 'tr-legende', 'geplant / Ist'));
  box.append(top);

  const werte = el('div', 'tr-kachel-werte');
  werte.append(el('span', 'tr-plan', fmtDauer(plan.min)));
  werte.append(el('span', 'tr-sep', '/'));
  const istNode = el('span', 'tr-istwert2', ist ? fmtDauer(ist.min) : '–');
  istNode.title = ist ? `${ist.n} Aktivität(en) laut Trainingsseite` : 'Kein Ist verfügbar';
  werte.append(istNode);
  box.append(werte);

  const kmText = [];
  if (plan.km) kmText.push(`${Math.round(plan.km * 10) / 10} km geplant`);
  if (ist && ist.km) kmText.push(`${ist.km} km Ist`);
  box.append(el('div', 'tr-kachel-km', kmText.join(' · ') || '\u00a0'));

  // Zwei Lagen gegen das Ziel: hell das Geplante, satt das Getane.
  const zielMin = Number(ziel) || 0;
  const bar = el('div', `tr-bar${zielMin > 0 ? '' : ' leer'}`);
  if (zielMin > 0) {
    const planFill = el('div', 'tr-barplan');
    planFill.style.width = `${Math.round(Math.min(1, plan.min / zielMin) * 100)}%`;
    const anteil = Math.min(1, (ist ? ist.min : 0) / zielMin);
    const fill = el('div', 'tr-barfill');
    fill.style.width = `${Math.round(anteil * 100)}%`;
    if (anteil >= 1) fill.classList.add('voll');
    bar.append(planFill, fill);
    bar.title = `Ziel ${fmtDauer(zielMin)} je Woche — hell: geplant, satt: Ist`;
  }
  box.append(bar);

  const zielZeile = el('label', 'tr-zielzeile');
  zielZeile.append(el('span', null, 'Ziel'));
  const zielFeld = document.createElement('input');
  zielFeld.type = 'text';
  zielFeld.className = 'tr-ziel';
  zielFeld.value = zielMin ? String(zielMin) : '';
  zielFeld.placeholder = '–';
  zielFeld.autocomplete = 'off';
  zielFeld.inputMode = 'numeric';
  zielFeld.dataset.trziel = sport;
  zielFeld.setAttribute('aria-label', `Wochenziel ${SPORT_LABEL[sport]} in Minuten`);
  zielZeile.append(zielFeld, el('span', null, 'min / Woche'));
  box.append(zielZeile);
  return box;
}

/**
 * @param {object} ctx
 * @param {Date[]} ctx.days
 * @param {(ymd: string) => object[]} ctx.einheitenFor
 * @param {{sportarten: object, gesamtMin: number}} ctx.ist   Wochen-Ist je Sportart
 * @param {(ymd: string) => object[]} ctx.tagesIst
 * @param {string} ctx.istZustand   'ok' | 'gesperrt' | 'keine' | 'fehler'
 * @param {string|null} ctx.istGrund
 * @param {object} ctx.ziele        Minuten je Sportart
 * @param {string} ctx.selected
 * @param {Date} ctx.today
 */
export function renderTrainingPlan(ctx) {
  const root = el('div', 'pl-page tr-page');

  const bar = el('div', 'pl-bar');
  const geplant = ctx.days.reduce(
    (s, d) => s + ctx.einheitenFor(ymd(d)).reduce((x, ev) => x + dauerMin(ev), 0), 0,
  );
  bar.append(el('span', 'pl-state',
    `${fmtDauer(geplant)} geplant · Ist ${ctx.istZustand === 'ok' ? fmtDauer(ctx.ist.gesamtMin) : '–'}`));
  if (ctx.istZustand !== 'ok') {
    const hinweis = el('span', 'tr-warn', ctx.istGrund || 'Kein Ist verfügbar.');
    bar.append(hinweis);
  }
  root.append(bar);

  // Kacheln nur fuer Sportarten, die geplant, getan oder mit Ziel versehen
  // sind — eine Reihe aus fuenf leeren Kacheln sagt nichts.
  const planJe = {};
  for (const d of ctx.days) {
    for (const ev of ctx.einheitenFor(ymd(d))) {
      const s = (ev.plan && ev.plan.sport) || 'other';
      if (!planJe[s]) planJe[s] = { min: 0, km: 0 };
      planJe[s].min += dauerMin(ev);
      planJe[s].km += Number(ev.plan && ev.plan.km) || 0;
    }
  }
  const sichtbar = SPORTS.filter((s) => planJe[s]
    || (ctx.ist.sportarten && ctx.ist.sportarten[s])
    || Number(ctx.ziele[s]) > 0);
  if (sichtbar.length) {
    const reihe = el('div', 'tr-kacheln');
    for (const s of sichtbar) {
      reihe.append(kachel(s, {
        plan: planJe[s] || { min: 0, km: 0 },
        ist: ctx.ist.sportarten ? ctx.ist.sportarten[s] : null,
        ziel: ctx.ziele[s],
      }));
    }
    root.append(reihe);
  }

  const grid = el('div', 'pl-grid');
  for (const d of ctx.days) {
    const key = ymd(d);
    grid.append(spalte(d, ctx.einheitenFor(key), {
      heute: sameDay(d, ctx.today),
      gewaehlt: key === ctx.selected,
      ist: ctx.istZustand === 'ok' ? ctx.tagesIst(key) : null,
    }));
  }
  root.append(grid);
  return root;
}
