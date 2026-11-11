// matheplan.js — Wochenraster fuer die Mathe-Bloecke.
//
// Was hier steht, sind echte Kalendertermine: dieselben Objekte wie unter K,
// nur mit `plan.kind === 'mathe'` markiert und um den Verweis auf eine
// Projektaufgabe ergaenzt. Kein zweiter Datenbestand, keine Kopie, kein
// Abgleich — ein Block, den man hier anlegt, steht sofort im Kalender.
//
// Rechts die offenen Aufgaben aus /projekte (nur gelesen, siehe
// projektquelle.js). Ein Klick darauf legt einen Block am gewaehlten Tag an.

import { el } from './views.js';
import { WEEKDAY_SHORT, isoDow, sameDay, ymd, hm } from './dates.js';

const pad2 = (n) => String(n).padStart(2, '0');

/** 'HH:MM' aus einem Termin-Zeitstempel; bei Ganztags leer. */
const zeitVon = (ev) => (ev.allDay ? '' : String(ev.start).slice(11, 16));
const zeitBis = (ev) => (ev.allDay ? '' : String(ev.end).slice(11, 16));

function block(ev, { erledigt = false } = {}) {
  const node = el('div', `pl mp-block${erledigt ? ' mp-done' : ''}`);
  node.dataset.mp = ev.id;

  const handle = el('span', 'pl-handle', '⠿');
  handle.setAttribute('aria-hidden', 'true');
  handle.title = 'Ziehen ändert Tag und Reihenfolge';

  const zeiten = el('div', 'pl-times');
  for (const [teil, wert, label] of [['start', zeitVon(ev), 'Beginn'], ['end', zeitBis(ev), 'Ende']]) {
    const i = document.createElement('input');
    i.type = 'text';
    i.className = 'pl-time';
    i.value = wert;
    i.placeholder = '–';
    i.autocomplete = 'off';
    i.inputMode = 'numeric';
    i.dataset.mp = ev.id;
    i.dataset.mpfield = teil;
    i.setAttribute('aria-label', label);
    zeiten.append(i);
    if (teil === 'start') zeiten.append(el('span', 'pl-dash', '–'));
  }

  // Mehrzeilig: in sieben Spalten neben der Aufgabenliste waere ein
  // einzeiliges Feld nach zehn Zeichen zu Ende. Hoehe setzt fitTitles().
  const titel = document.createElement('textarea');
  titel.rows = 1;
  titel.className = 'pl-title pl-wrap';
  titel.spellcheck = false;
  titel.value = ev.title;
  titel.autocomplete = 'off';
  titel.dataset.mp = ev.id;
  titel.dataset.mpfield = 'title';
  titel.setAttribute('aria-label', 'Bezeichnung');

  const del = el('button', 'pl-del', '×');
  del.type = 'button';
  del.dataset.mpdel = ev.id;
  del.setAttribute('aria-label', `„${ev.title}“ löschen`);

  node.append(handle, zeiten, titel, del);

  const p = ev.plan || {};
  if (p.projectTitle) {
    const ref = el('div', 'mp-ref');
    ref.append(el('span', 'mp-dot'));
    ref.append(el('span', 'mp-reftext', p.projectTitle));
    if (erledigt) ref.append(el('span', 'mp-fertig', 'erledigt'));
    ref.title = erledigt
      ? 'Die zugehörige Projektaufgabe ist inzwischen abgehakt.'
      : 'Gehört zu einer Aufgabe aus /projekte';
    node.append(ref);
  }
  return node;
}

function spalte(tag, bloecke, { heute = false, gewaehlt = false, projekte = [], erledigt }) {
  const key = ymd(tag);
  const col = el('section', 'pl-col');
  col.dataset.mpkey = key;
  if (heute) col.classList.add('today');
  if (gewaehlt) col.classList.add('selected');

  const head = el('div', 'pl-head');
  const titel = el('div', 'pl-col-title');
  titel.dataset.mpgoto = key;
  titel.append(el('span', 'dow', WEEKDAY_SHORT[isoDow(tag)]));
  titel.append(el('span', 'num', String(tag.getDate())));
  head.append(titel);
  const minuten = bloecke.reduce((s, ev) => s + dauerMin(ev), 0);
  head.append(el('div', 'pl-count', minuten ? fmtDauer(minuten) : ''));
  col.append(head);

  const list = el('div', 'pl-list');
  list.dataset.mpkey = key;
  for (const ev of bloecke) list.append(block(ev, { erledigt: erledigt(ev) }));
  if (!bloecke.length) list.append(el('p', 'empty', 'Nichts geplant.'));
  col.append(list);

  const form = el('form', 'pl-add');
  form.dataset.mpkey = key;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Block…';
  input.autocomplete = 'off';
  input.dataset.mpadd = key;
  input.setAttribute('aria-label', `Neuer Mathe-Block am ${key}`);
  const add = el('button', 'primary', '+');
  add.type = 'submit';
  add.setAttribute('aria-label', 'Block anlegen');
  form.append(input, add);
  col.append(form);
  void projekte;
  return col;
}

export function dauerMin(ev) {
  if (ev.allDay) return 0;
  const a = String(ev.start).slice(11, 16);
  const b = String(ev.end).slice(11, 16);
  const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, min(b) - min(a));
}

export function fmtDauer(min) {
  if (!min) return '0:00';
  return `${Math.floor(min / 60)}:${pad2(min % 60)}`;
}

/**
 * @param {object} ctx
 * @param {Date[]} ctx.days            die sieben Tage der Woche
 * @param {(ymd: string) => object[]} ctx.bloeckeFor   Mathe-Termine je Tag
 * @param {object[]} ctx.aufgaben      offene Projektaufgaben
 * @param {string|null} ctx.aufgabenGrund  Hinweis, falls keine Aufgaben da sind
 * @param {string|null} ctx.stand      Zeitstempel des Projektstands
 * @param {string} ctx.selected        gewaehlter Tag
 * @param {Date} ctx.today
 * @param {(ev: object) => boolean} ctx.erledigt
 */
export function renderMathePlan(ctx) {
  const root = el('div', 'pl-page mp-page');

  const tools = el('div', 'pl-bar');
  const summe = ctx.days.reduce(
    (s, d) => s + ctx.bloeckeFor(ymd(d)).reduce((x, ev) => x + dauerMin(ev), 0), 0,
  );
  tools.append(el('span', 'pl-state',
    summe ? `${fmtDauer(summe)} geplant in dieser Woche` : 'Noch nichts geplant'));
  tools.append(el('span', 'mp-hint',
    'Blöcke sind echte Termine und stehen auch im Kalender.'));
  root.append(tools);

  const unten = el('div', 'mp-body');

  const grid = el('div', 'pl-grid');
  for (const d of ctx.days) {
    const key = ymd(d);
    grid.append(spalte(d, ctx.bloeckeFor(key), {
      heute: sameDay(d, ctx.today),
      gewaehlt: key === ctx.selected,
      erledigt: ctx.erledigt,
    }));
  }
  unten.append(grid);
  unten.append(aufgabenSpalte(ctx));
  root.append(unten);
  return root;
}

function aufgabenSpalte(ctx) {
  const box = el('aside', 'mp-side');
  const head = el('div', 'pl-preview-head');
  head.append(el('div', 'pl-preview-title', 'Projektaufgaben'));
  head.append(el('div', 'pl-count', ctx.aufgaben.length ? String(ctx.aufgaben.length) : ''));
  box.append(head);

  const list = el('div', 'mp-tasks');
  if (!ctx.aufgaben.length) {
    list.append(el('p', 'empty', ctx.aufgabenGrund || 'Keine offenen Aufgaben.'));
  }
  for (const [i, t] of ctx.aufgaben.entries()) {
    const row = el('button', 'mp-task');
    row.type = 'button';
    row.dataset.mptask = String(i);
    row.style.setProperty('--c', t.color || 'var(--accent-2)');
    row.append(el('span', 'mp-dot'));
    const text = el('span', 'mp-tasktext');
    text.append(el('span', 'mp-tasktitle', t.title));
    const unten = el('span', 'mp-taskmeta');
    unten.append(el('span', null, t.projectTitle));
    if (t.due) unten.append(el('span', 'mp-due', `bis ${t.due.slice(8, 10)}.${t.due.slice(5, 7)}.`));
    text.append(unten);
    row.append(text);
    row.title = `${t.title} — ${t.projectTitle}${t.milestoneTitle ? ` · ${t.milestoneTitle}` : ''}\n`
      + 'Klick legt einen Block am gewählten Tag an.';
    list.append(row);
  }
  box.append(list);

  const fuss = el('p', 'pl-preview-foot');
  fuss.textContent = ctx.stand
    ? `Projektstand von ${new Date(ctx.stand).toLocaleDateString('de-AT')} — Änderungen auf /projekte`
    : 'Änderungen an Projekten auf /projekte';
  box.append(fuss);
  return box;
}

export { hm };
