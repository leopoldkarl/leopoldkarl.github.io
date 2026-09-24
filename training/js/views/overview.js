// Übersicht: Zeitraum-Kacheln, Form, Wochenvolumen, Aktivitätskalender,
// Jahresvergleich, letzte Aktivitäten.

import { h, barChart, heatmap, lineChart } from '../charts.js';
import * as F from '../format.js';
import * as M from '../model.js';
import { card, stat, segmented, catColor, activityRow, emptyNote } from '../ui.js';

const METRICS = {
  time: { label: 'Zeit', get: a => a.moving || 0, fmt: v => F.hours(v), axis: v => `${F.num(v / 3600, v && v < 36000 ? 0 : 0)} h` },
  dist: { label: 'Distanz', get: a => a.dist || 0, fmt: v => F.km(v, 0), axis: v => `${F.num(v / 1000)} km` },
  tss: { label: 'TSS', get: a => a.tss || 0, fmt: v => F.num(Math.round(v)), axis: v => F.num(v) },
};

export function renderOverview(root, ctx) {
  const { acts, model, prefs } = ctx;
  if (!acts.length) { root.append(emptyNote('Keine Aktivitäten für diese Auswahl.')); return; }
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = M.addDays(t0, 1);

  // ---------------------------------------------------------- Kacheln
  const wk = M.startOfWeek(t0);
  const thisWeek = M.periodStats(M.inRange(acts, wk, tomorrow));
  const lastWeek = M.periodStats(M.inRange(acts, M.addDays(wk, -7), wk));
  const four = M.periodStats(M.inRange(acts, M.addDays(t0, -27), tomorrow));
  const yr = new Date(t0.getFullYear(), 0, 1);
  const year = M.periodStats(M.inRange(acts, yr, tomorrow));
  const pm = M.pmc(model.acts, M.addDays(t0, -1), t0);            // PMC immer über alle Sportarten
  const ctl = pm.ctl.at(-1) ?? 0, atl = pm.atl.at(-1) ?? 0, tsb = ctl - atl;

  const tile = (title, big, rows, foot) => h('div', { class: 'tile' },
    h('div', { class: 'tile-title', text: title }),
    h('div', { class: 'tile-big', text: big }),
    h('dl', { class: 'tile-rows' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    foot ? h('div', { class: 'tile-foot', text: foot }) : null);

  root.append(h('div', { class: 'tiles' },
    tile('Diese Woche', F.duration(thisWeek.time, { short: true }), [
      ['Distanz', F.km(thisWeek.dist, 1)], ['Aktivitäten', thisWeek.count], ['TSS', F.num(Math.round(thisWeek.tss))],
    ], `Vorwoche: ${F.duration(lastWeek.time, { short: true })} · ${F.km(lastWeek.dist, 0)}`),
    tile('Letzte 4 Wochen', F.duration(four.time, { short: true }), [
      ['Distanz', F.km(four.dist, 0)], ['Aktivitäten', four.count], ['Ø pro Woche', F.duration(four.time / 4, { short: true })],
    ]),
    tile(`Jahr ${t0.getFullYear()}`, F.duration(year.time, { short: true }), [
      ['Distanz', F.km(year.dist, 0)], ['Höhenmeter', F.num(Math.round(year.ascent))], ['Aktivitäten', year.count],
    ]),
    tile('Form (alle Sportarten)', F.signed(Math.round(tsb)), [
      ['Fitness (CTL)', F.num(Math.round(ctl))], ['Ermüdung (ATL)', F.num(Math.round(atl))], ['Zustand', formLabel(tsb)],
    ], 'TSB = CTL − ATL, Stand gestern'),
  ));

  // ---------------------------------------------------------- Wochenvolumen
  const volHost = h('div');
  const drawVol = () => {
    const metric = METRICS[prefs.get('ov.metric', 'time')];
    const weeks = +prefs.get('ov.weeks', 26);
    const start = M.addDays(wk, -7 * (weeks - 1));
    const labels = [], ticks = [], titles = [];
    const stacks = M.CATS.map(c => ({ key: c, label: M.CAT_LABEL[c], color: catColor(c), values: new Array(weeks).fill(0) }));
    for (let i = 0; i < weeks; i++) {
      const d = M.addDays(start, 7 * i);
      labels.push(F.dateTiny(d));
      ticks.push(d.getDate() <= 7 ? F.MON[d.getMonth()] : '');
      titles.push(`Woche ab ${F.dateTiny(d)}${d.getFullYear()}`);
    }
    const startK = M.dayKey(start);
    for (const a of acts) {
      if (a.day < startK) continue;
      const i = Math.floor(M.dayDiff(start, a.date) / 7);
      if (i >= 0 && i < weeks) stacks[M.CATS.indexOf(a.cat)].values[i] += metric.get(a);
    }
    const isTime = metric === METRICS.time;
    if (isTime) for (const st of stacks) st.values = st.values.map(v => v / 3600);
    barChart(volHost, {
      labels, tickLabels: ticks, stacks, height: 220,
      yFmt: v => isTime ? `${F.num(v)} h` : metric.axis(v),
      tipFmt: v => isTime ? F.duration(v * 3600, { short: true }) : metric.fmt(v),
      title: i => titles[i],
    });
  };
  const volActions = h('div', { class: 'card-actions' },
    segmented([['time', 'Zeit'], ['dist', 'Distanz'], ['tss', 'TSS']], prefs.get('ov.metric', 'time'), v => { prefs.set('ov.metric', v); drawVol(); }, 'Messgröße'),
    segmented([[12, '12 W'], [26, '26 W'], [52, '52 W']], +prefs.get('ov.weeks', 26), v => { prefs.set('ov.weeks', v); drawVol(); }, 'Zeitraum'));
  root.append(card('Wochenvolumen', volHost, { actions: volActions }));
  drawVol();

  // ---------------------------------------------------------- Kalender
  const byDay = new Map();
  for (const a of acts) { if (!byDay.has(a.day)) byDay.set(a.day, []); byDay.get(a.day).push(a); }
  const hmHost = h('div');
  const weeksHM = 53;
  const hmStart = M.addDays(wk, -7 * (weeksHM - 1));
  const dayTime = d => (byDay.get(M.dayKey(d)) || []).reduce((s, a) => s + (a.moving || 0), 0);
  const vals = [...byDay.entries()].filter(([k]) => k >= M.dayKey(hmStart)).map(([, l]) => l.reduce((s, a) => s + (a.moving || 0), 0)).sort((a, b) => a - b);
  const max = vals.length ? vals[Math.floor(vals.length * 0.95)] || vals.at(-1) : 1;
  const activeDays = vals.length;
  heatmap(hmHost, {
    start: hmStart, weeks: weeksHM, max,
    value: dayTime,
    monthLabel: d => F.MON[d.getMonth()],
    title: d => F.dateLong(M.dayKey(d)),
    rows: d => {
      const l = byDay.get(M.dayKey(d)) || [];
      return l.length ? l.map(a => ({ color: catColor(a.cat), shape: 'rect', value: F.duration(a.moving, { short: true }), label: a.name }))
        : [{ value: 'Ruhetag', label: '' }];
    },
    onClick: d => {
      const l = byDay.get(M.dayKey(d)) || [];
      if (l.length === 1) location.hash = `#/a/${encodeURIComponent(l[0].id)}`;
      else if (l.length) location.hash = `#/aktivitaeten?tag=${M.dayKey(d)}`;
    },
  });
  const legendHM = h('div', { class: 'hm-legend' }, h('span', { class: 'muted', text: 'weniger' }),
    [0, 1, 2, 3, 4].map(l => h('span', { class: `hm-swatch l${l}` })), h('span', { class: 'muted', text: 'mehr Trainingszeit' }));
  root.append(card('Aktivitätskalender', h('div', {}, hmHost, legendHM), { sub: `${activeDays} Trainingstage in den letzten 12 Monaten` }));

  // ---------------------------------------------------------- Jahresvergleich
  const yHost = h('div');
  const drawYears = () => {
    const metric = METRICS[prefs.get('ov.ymetric', 'dist')];
    const years = [...new Set(acts.map(a => a.date.getFullYear()))].sort().slice(-4);
    const x = Array.from({ length: 366 }, (_, i) => i + 1);
    const cur = t0.getFullYear();
    const doyToday = M.dayDiff(new Date(cur, 0, 1), t0) + 1;
    const series = years.map(y => {
      const daily = new Array(367).fill(0);
      for (const a of acts) if (a.date.getFullYear() === y) daily[M.dayDiff(new Date(y, 0, 1), a.date) + 1] += metric.get(a);
      let acc = 0;
      const firstDoy = y === model.acts[0].date.getFullYear() ? M.dayDiff(new Date(y, 0, 1), model.acts[0].date) + 1 : 1;
      const vals = x.map(d => ((y === cur && d > doyToday) || d < firstDoy) ? null : (acc += daily[d]));
      const age = cur - y;
      return {
        label: String(y), values: vals, thin: age > 0,
        color: age === 0 ? 'var(--c-accent)' : age === 1 ? 'var(--c-prev1)' : 'var(--c-prev2)',
        fmt: metric.fmt,
      };
    }).reverse();
    const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334].map((d, i) => ({ v: d + 1, label: F.MON[i] }));
    lineChart(yHost, {
      x,
      xTicks: (lo, hi, w) => monthStarts.filter((_, i) => w > 560 || i % 2 === 0),
      xFmt: d => { const dt = M.addDays(new Date(2025, 0, 1), d - 1); return `${dt.getDate()}. ${F.MON[dt.getMonth()]}`; },
      panels: [{ label: '', height: 220, series, zero: true, yFmt: metric.axis }],
    });
  };
  root.append(card('Jahresvergleich (kumuliert)', yHost, {
    actions: segmented([['dist', 'Distanz'], ['time', 'Zeit'], ['tss', 'TSS']], prefs.get('ov.ymetric', 'dist'), v => { prefs.set('ov.ymetric', v); drawYears(); }, 'Messgröße'),
  }));
  drawYears();

  // ---------------------------------------------------------- Letzte Aktivitäten
  const recent = acts.slice(-8).reverse();
  root.append(card('Letzte Aktivitäten', h('div', { class: 'act-list' }, recent.map(activityRow)), {
    actions: h('a', { class: 'link-btn', href: '#/aktivitaeten', text: 'Alle anzeigen' }),
  }));
}

export function formLabel(tsb) {
  if (tsb > 15) return 'sehr erholt';
  if (tsb > 5) return 'frisch';
  if (tsb >= -10) return 'neutral';
  if (tsb >= -30) return 'im Aufbau';
  return 'hohe Belastung';
}
