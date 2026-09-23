// journal.js — Tagebuchseite: Datenfelder, abgeleitete Summen, Freitext.
//
// Das Feldschema liegt im Zustand (store.js, DEFAULT_JOURNAL_SCHEMA), nicht
// hier. Dieses Modul kennt nur die Typen und weiss, wie man sie zeichnet und
// ausliest. Ein neues Feld braucht deshalb nur einen Eintrag im Schema.

import { hm, ymd } from './dates.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ */
/* Abgeleitete Werte                                                   */
/* ------------------------------------------------------------------ */

/** Minutenanteil eines numtext- oder number-Feldes, 0 wenn leer. */
function mins(values, id) {
  const v = values[id];
  if (v == null) return 0;
  const n = typeof v === 'object' ? Number(v.n) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function flag(values, id) {
  return values[id] === true;
}

/**
 * Mathezeit in Stunden = Paper + Forschung + Lehrbuchvortrag + Anki + Lektüre.
 *
 * Bewusst NICHT enthalten: "Projekt". Leo hat es in der Summenformel nicht
 * genannt; bevor ich es stillschweigend dazurechne, bleibt es draussen.
 */
export function mathezeit(values) {
  return (mins(values, 'paper') + mins(values, 'forschung') + mins(values, 'lehrbuchvortrag')
        + mins(values, 'anki') + mins(values, 'lektuere')) / 60;
}

/**
 * Sportzeit in Stunden = Sporteinheiten 1–3
 *   + 15 min falls Kraft, + 5 min falls Mobilisation, + 10 min falls Dehnen.
 */
export function sportzeit(values) {
  const einheiten = mins(values, 'sport1') + mins(values, 'sport2') + mins(values, 'sport3');
  const zuschlag = (flag(values, 'kraft') ? 15 : 0)
                 + (flag(values, 'mobilisation') ? 5 : 0)
                 + (flag(values, 'dehnen') ? 10 : 0);
  return (einheiten + zuschlag) / 60;
}

export const FORMULAS = { mathe: mathezeit, sport: sportzeit };

export function computeField(field, values) {
  const fn = FORMULAS[field.formula];
  return fn ? fn(values) : null;
}

/** Stunden als '2:45 h' statt '2.75 h' — beim Lesen deutlich schneller. */
export function formatHours(h) {
  if (!Number.isFinite(h) || h <= 0) return '0:00';
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Eingabefelder                                                       */
/* ------------------------------------------------------------------ */

function numberInput(field, value, unit) {
  const wrap = el('div', 'jf-num');
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.step = String(field.step ?? 1);
  input.min = '0';
  input.value = value ?? '';
  input.dataset.jfield = field.id;
  input.dataset.jpart = 'n';
  input.setAttribute('aria-label', field.label);
  wrap.append(input);
  if (unit) wrap.append(el('span', 'jf-unit', unit));
  return wrap;
}

function renderField(field, values) {
  const row = el('div', `jf jf-${field.type}`);
  row.dataset.jrow = field.id;
  const label = el('label', 'jf-label', field.label);
  row.append(label);

  const v = values[field.id];

  switch (field.type) {
    case 'computed': {
      const h = computeField(field, values);
      row.append(el('div', 'jf-computed', `${formatHours(h)} ${field.unit || ''}`.trim()));
      break;
    }
    case 'number':
      row.append(numberInput(field, v ?? '', field.unit));
      break;

    case 'scale5': {
      const group = el('div', 'jf-scale');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', field.label);
      for (let i = 1; i <= 5; i += 1) {
        const b = el('button', 'jf-dot', String(i));
        b.type = 'button';
        b.dataset.jfield = field.id;
        b.dataset.jvalue = String(i);
        b.setAttribute('aria-pressed', String(Number(v) === i));
        if (Number(v) === i) b.classList.add('on');
        group.append(b);
      }
      row.append(group);
      break;
    }

    case 'bool': {
      const b = el('button', 'jf-bool', v === true ? 'ja' : (v === false ? 'nein' : '—'));
      b.type = 'button';
      b.dataset.jfield = field.id;
      b.dataset.jtoggle = '1';
      b.classList.toggle('yes', v === true);
      b.classList.toggle('no', v === false);
      b.setAttribute('aria-label', `${field.label}: ${v === true ? 'ja' : v === false ? 'nein' : 'nicht gesetzt'}`);
      row.append(b);
      break;
    }

    case 'numtext': {
      const pair = el('div', 'jf-pair');
      pair.append(numberInput(field, (v && v.n != null) ? v.n : '', field.unit));
      const text = document.createElement('input');
      text.type = 'text';
      text.autocomplete = 'off';
      text.value = (v && v.text) ? v.text : '';
      text.dataset.jfield = field.id;
      text.dataset.jpart = 'text';
      text.setAttribute('aria-label', `${field.label} — Notiz`);
      pair.append(text);
      row.append(pair);
      break;
    }

    case 'text':
    default: {
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.value = v ?? '';
      input.dataset.jfield = field.id;
      input.dataset.jpart = 'plain';
      input.setAttribute('aria-label', field.label);
      row.append(input);
      break;
    }
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Seite                                                               */
/* ------------------------------------------------------------------ */

/**
 * ctx: { dateYmd, schema, values, entry, occurrences, doneTasks, openTasks, colorOf }
 */
export function renderJournal(ctx) {
  const { schema, values } = ctx;
  const root = el('div', 'jr');

  /* Kopfzeile mit den abgeleiteten Werten */
  const strip = el('div', 'jr-strip');
  const computed = schema.filter((f) => f.type === 'computed');
  for (const f of computed) {
    const card = el('div', 'jr-stat');
    card.append(el('div', 'k', f.label));
    card.append(el('div', 'v', formatHours(computeField(f, values))));
    card.append(el('div', 'u', 'Stunden'));
    strip.append(card);
  }
  const schlaf = Number(values.schlafzeit);
  if (Number.isFinite(schlaf) && schlaf > 0) {
    const card = el('div', 'jr-stat');
    card.append(el('div', 'k', 'Schlafzeit'));
    card.append(el('div', 'v', formatHours(schlaf)));
    card.append(el('div', 'u', 'Stunden'));
    strip.insertBefore(card, strip.firstChild);
  }
  // Freitextfelder, die in die Kopfzeile gehoeren (Tagesevent, Glücksmoment).
  for (const f of schema.filter((x) => x.strip)) {
    const card = el('div', 'jr-note');
    const lbl = el('label', 'k', f.label);
    lbl.setAttribute('for', `jrnote-${f.id}`);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `jrnote-${f.id}`;
    input.autocomplete = 'off';
    input.value = values[f.id] ?? '';
    input.dataset.jfield = f.id;
    input.dataset.jpart = 'plain';
    input.placeholder = '…';
    card.append(lbl, input);
    strip.append(card);
  }

  if (strip.children.length) root.append(strip);

  /* Zwei Spalten: links die Felder, rechts Termine, erledigte Aufgaben, Text */
  const cols = el('div', 'jr-cols');

  const left = el('section', 'panel jr-fields');
  left.append(el('h2', null, 'Daten'));
  const grid = el('div', 'jf-grid');
  for (const f of schema) {
    if (f.type === 'computed' || f.strip) continue;   // stehen schon oben im Streifen
    grid.append(renderField(f, values));
  }
  left.append(grid);
  cols.append(left);

  const right = el('div', 'jr-right');

  const evPanel = el('section', 'panel');
  evPanel.append(el('h2', null, 'Termine des Tages'));
  if (!ctx.occurrences.length) {
    evPanel.append(el('p', 'empty', 'Keine Termine.'));
  } else {
    const ul = el('ul', 'agenda');
    for (const o of ctx.occurrences) {
      const li = el('li');
      const dot = el('span', 'dot');
      dot.style.setProperty('--c', ctx.colorOf(o.event.category));
      li.append(dot, el('span', 'tm', o.allDay ? 'ganztg.' : `${hm(o.start)}–${hm(o.end)}`),
        el('span', 'tx', o.event.title || '(ohne Titel)'));
      ul.append(li);
    }
    evPanel.append(ul);
  }
  right.append(evPanel);

  const taskPanel = el('section', 'panel');
  taskPanel.append(el('h2', null, `Erledigte Aufgaben (${ctx.doneTasks.length})`));
  if (!ctx.doneTasks.length) {
    taskPanel.append(el('p', 'empty', 'Nichts abgehakt.'));
  } else {
    const ul = el('ul', 'jr-done');
    for (const t of ctx.doneTasks) ul.append(el('li', null, t.title));
    taskPanel.append(ul);
  }
  if (ctx.openTasks.length) {
    taskPanel.append(el('p', 'hint', `${ctx.openTasks.length} offen geblieben.`));
  }
  right.append(taskPanel);

  const entryPanel = el('section', 'panel jr-entry');
  entryPanel.append(el('h2', null, 'Tagebucheintrag'));
  const ta = document.createElement('textarea');
  ta.id = 'jr-entry-text';
  ta.value = ctx.entry || '';
  ta.placeholder = 'Was war heute …';
  ta.setAttribute('aria-label', 'Tagebucheintrag');
  entryPanel.append(ta);
  right.append(entryPanel);

  cols.append(right);
  root.append(cols);
  return root;
}

export { el, ymd };
