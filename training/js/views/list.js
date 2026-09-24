// Aktivitäten: durchsuchbare, sortierbare Tabelle.

import { h } from '../charts.js';
import * as F from '../format.js';
import { card, sportTag, speedOf, table, emptyNote } from '../ui.js';

const PAGE = 50;

export function renderList(root, ctx) {
  const { acts, query, prefs } = ctx;
  const years = [...new Set(acts.map(a => a.date.getFullYear()))].sort((a, b) => b - a);
  const state = {
    q: '', year: 'all', page: 0,
    sort: prefs.get('list.sort', { col: 0, dir: -1 }),
    day: query.get('tag'),
  };

  const cols = [
    { label: 'Datum', value: a => F.dateShort(a.start), sort: a => a.ts },
    { label: 'Sport', value: a => sportTag(a), sort: a => a.cat },
    { label: 'Name', value: a => h('a', { class: 'name-link', href: `#/a/${encodeURIComponent(a.id)}`, text: a.name }), sort: a => a.name.toLowerCase() },
    { label: 'Zeit', value: a => F.duration(a.moving), sort: a => a.moving || 0, num: true },
    { label: 'Distanz', value: a => a.dist ? F.km(a.dist) : F.DASH, sort: a => a.dist || 0, num: true },
    { label: 'Tempo', value: a => a.dist ? speedOf(a) : F.DASH, num: true },
    { label: 'Hm', value: a => a.ascent != null && a.cat !== 'swim' ? F.num(a.ascent) : F.DASH, sort: a => a.ascent || 0, num: true },
    { label: 'Ø HF', value: a => a.hr_avg ?? F.DASH, sort: a => a.hr_avg || 0, num: true },
    { label: 'NP', value: a => a.np ? `${a.np} W` : F.DASH, sort: a => a.np || 0, num: true },
    { label: 'TSS', value: a => a.tss ? Math.round(a.tss) : F.DASH, sort: a => a.tss || 0, num: true },
  ];

  const search = h('input', { type: 'search', class: 'input', placeholder: 'Name suchen …', 'aria-label': 'Suche' });
  const yearSel = h('select', { class: 'input', 'aria-label': 'Jahr' },
    h('option', { value: 'all', text: 'Alle Jahre' }), years.map(y => h('option', { value: y, text: y })));
  const info = h('span', { class: 'muted' });
  const body = h('div');
  const pager = h('div', { class: 'pager' });
  const dayChip = state.day ? h('button', {
    class: 'chip active', type: 'button', text: `Tag: ${F.dateShort(state.day)} ✕`,
    onclick: () => { state.day = null; dayChip.remove(); history.replaceState(null, '', '#/aktivitaeten'); draw(); },
  }) : null;

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return acts.filter(a =>
      (!q || a.name.toLowerCase().includes(q)) &&
      (state.year === 'all' || a.date.getFullYear() === +state.year) &&
      (!state.day || a.day === state.day));
  }

  function draw() {
    const rows = filtered();
    const c = cols[state.sort.col];
    rows.sort((a, b) => {
      const x = c.sort(a), y = c.sort(b);
      return (x < y ? -1 : x > y ? 1 : 0) * state.sort.dir;
    });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const slice = rows.slice(state.page * PAGE, (state.page + 1) * PAGE);
    const tot = rows.reduce((s, a) => ({ t: s.t + (a.moving || 0), d: s.d + (a.dist || 0) }), { t: 0, d: 0 });
    info.textContent = `${rows.length} Aktivitäten · ${F.duration(tot.t, { short: true })} · ${F.km(tot.d, 0)}`;
    body.replaceChildren(slice.length ? table(slice, cols, {
      onRow: a => { location.hash = `#/a/${encodeURIComponent(a.id)}`; },
      sortState: state.sort,
      onSort: i => {
        state.sort = { col: i, dir: state.sort.col === i ? -state.sort.dir : (i <= 2 ? -1 : -1) };
        prefs.set('list.sort', state.sort);
        draw();
      },
    }) : emptyNote('Keine Treffer.'));
    pager.replaceChildren();
    if (pages > 1) {
      pager.append(
        h('button', { type: 'button', text: '‹ Zurück', disabled: state.page === 0, onclick: () => { state.page--; draw(); } }),
        h('span', { class: 'muted', text: `Seite ${state.page + 1} von ${pages}` }),
        h('button', { type: 'button', text: 'Weiter ›', disabled: state.page >= pages - 1, onclick: () => { state.page++; draw(); } }));
    }
  }
  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  yearSel.addEventListener('change', () => { state.year = yearSel.value; state.page = 0; draw(); });

  root.append(card('Aktivitäten', h('div', {},
    h('div', { class: 'toolbar' }, search, yearSel, dayChip, info), body, pager)));
  draw();
}
