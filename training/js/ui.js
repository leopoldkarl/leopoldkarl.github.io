// ui.js — wiederkehrende Bausteine.

import { h } from './charts.js';
import * as F from './format.js';
import { CAT_LABEL } from './model.js';

export const catColor = cat => `var(--c-${cat})`;

// Ordinale Rampe mit 7 Stufen; 5-Zonen-Modelle nutzen eine gespreizte Auswahl
export const zoneColor = (i, n) => `var(--z${n === 5 ? [1, 3, 4, 5, 7][i] : i + 1})`;

export function card(title, body, { actions, cls, sub } = {}) {
  return h('section', { class: `card ${cls || ''}` },
    (title || actions) ? h('div', { class: 'card-head' },
      h('div', {}, title ? h('h2', { text: title }) : null, sub ? h('p', { class: 'card-sub', text: sub }) : null),
      actions || null) : null,
    body);
}

export function stat(label, value, sub) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-label', text: label }),
    h('div', { class: 'stat-value', text: value }),
    sub ? h('div', { class: 'stat-sub', text: sub }) : null);
}

export function segmented(options, value, onChange, label) {
  const g = h('div', { class: 'segmented', role: 'group', 'aria-label': label || '' });
  for (const [v, text] of options) {
    g.append(h('button', {
      type: 'button', 'aria-pressed': String(v === value), text,
      onclick: () => {
        for (const b of g.children) b.setAttribute('aria-pressed', 'false');
        g.children[options.findIndex(o => o[0] === v)].setAttribute('aria-pressed', 'true');
        onChange(v);
      },
    }));
  }
  return g;
}

export function sportTag(a) {
  return h('span', { class: 'sport-tag' },
    h('span', { class: 'sport-dot', style: { background: catColor(a.cat) } }),
    h('span', { text: sportName(a) }));
}

const SUB_NAMES = {
  treadmill: 'Laufband', trail: 'Trail', track: 'Bahn', indoor_cycling: 'Indoor-Rad',
  virtual_activity: 'Virtuell', mountain: 'MTB', gravel_cycling: 'Gravel', road: 'Rennrad',
  lap_swimming: 'Becken', open_water: 'Freiwasser', strength_training: 'Kraft',
  cardio_training: 'Cardio', hiit: 'HIIT',
};
const SPORT_NAMES = {
  walking: 'Gehen', hiking: 'Wandern', rowing: 'Rudern', cross_country_skiing: 'Langlauf',
  alpine_skiing: 'Ski alpin', yoga: 'Yoga', tennis: 'Tennis', rock_climbing: 'Klettern',
  sailing: 'Segeln', stand_up_paddleboarding: 'SUP', fitness_equipment: 'Fitnessgeräte',
  training: 'Training', generic: 'Aktivität', e_biking: 'E-Bike',
};

export function sportName(a) {
  if (a.cat === 'other') return SPORT_NAMES[a.sport] || SUB_NAMES[a.sub] || CAT_LABEL.other;
  const sub = SUB_NAMES[a.sub];
  return sub && a.cat !== 'strength' ? `${CAT_LABEL[a.cat]} · ${sub}` : CAT_LABEL[a.cat];
}

// Hauptgeschwindigkeit in der sportueblichen Einheit
export function speedOf(a) {
  if (a.cat === 'run' || a.sport === 'walking' || a.sport === 'hiking') return F.pace(a.v_avg, 1000);
  if (a.cat === 'swim') return F.pace(a.v_avg, 100);
  if (a.cat === 'ride') return F.kmh(a.v_avg);
  return a.v_avg ? F.kmh(a.v_avg) : F.DASH;
}

export function activityHref(a) {
  return `#/a/${encodeURIComponent(a.id)}`;
}

export function activityRow(a) {
  const bits = [];
  if (a.dist) bits.push(F.km(a.dist));
  bits.push(F.duration(a.moving));
  if (a.dist && a.cat !== 'strength') bits.push(speedOf(a));
  if (a.ascent > 20 && a.cat !== 'swim') bits.push(`${F.num(a.ascent)} Hm`);
  if (a.tss) bits.push(`${Math.round(a.tss)} TSS`);
  return h('a', { class: 'act-row', href: activityHref(a) },
    h('span', { class: 'act-bar', style: { background: catColor(a.cat) } }),
    h('span', { class: 'act-main' },
      h('span', { class: 'act-name', text: a.name }),
      h('span', { class: 'act-meta', text: `${F.dateShort(a.start)} · ${F.time(a.start)} · ${sportName(a)}` })),
    h('span', { class: 'act-stats', text: bits.join(' · ') }));
}

export function emptyNote(text) {
  return h('p', { class: 'empty', text });
}

// Tabelle: cols = [{label, value(a) -> string|Node, sort(a) -> number|string, num}]
export function table(rows, cols, { onRow, sortState, onSort } = {}) {
  const thead = h('tr', {}, cols.map((c, i) => {
    const th = h('th', { class: c.num ? 'num' : '', scope: 'col' });
    if (c.sort && onSort) {
      const dir = sortState?.col === i ? sortState.dir : null;
      th.setAttribute('aria-sort', dir === 1 ? 'ascending' : dir === -1 ? 'descending' : 'none');
      th.append(h('button', { class: 'th-sort', type: 'button', onclick: () => onSort(i) },
        c.label, h('span', { class: 'sort-ind', text: dir === 1 ? '▲' : dir === -1 ? '▼' : '' })));
    } else th.textContent = c.label;
    return th;
  }));
  const tbody = h('tbody', {}, rows.map(r => {
    const tr = h('tr', {}, cols.map(c => {
      const v = c.value(r);
      return h('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : String(v ?? F.DASH));
    }));
    if (onRow) { tr.classList.add('clickable'); tr.addEventListener('click', e => { if (!e.target.closest('a')) onRow(r); }); }
    return tr;
  }));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, thead), tbody));
}
