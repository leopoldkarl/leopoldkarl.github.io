// Einzelne Aktivität: Kennzahlen, Karte, Verlaufsdiagramm mit Auswahl,
// Splits, Runden, Zonen, Mean-Max, Bahnen bzw. Sätze.

import { h, lineChart, curveChart, zoneBars } from '../charts.js';
import * as F from '../format.js';
import * as M from '../model.js';
import { loadDetail } from '../source.js';
import { routeMap } from '../map.js';
import { card, stat, segmented, sportTag, table, speedOf, emptyNote, zoneColor } from '../ui.js';

const EXERCISES = {
  squat: 'Kniebeuge', bench_press: 'Bankdrücken', deadlift: 'Kreuzheben', pull_up: 'Klimmzug',
  push_up: 'Liegestütz', row: 'Rudern', lunge: 'Ausfallschritt', plank: 'Plank', crunch: 'Crunch',
  shoulder_press: 'Schulterdrücken', curl: 'Curl', triceps_extension: 'Trizepsstrecken',
  lat_pulldown: 'Latziehen', leg_curl: 'Beinbeuger', leg_raise: 'Beinheben', calf_raise: 'Wadenheben',
  hip_raise: 'Hüftheben', core: 'Rumpf', cardio: 'Cardio', carry: 'Tragen', chop: 'Chop',
  flye: 'Fliegende', hyperextension: 'Hyperextension', olympic_lift: 'Olympisches Heben',
  sit_up: 'Sit-up', shrug: 'Shrug', hip_stability: 'Hüftstabilität', total_body: 'Ganzkörper',
};
const STROKES = { freestyle: 'Kraul', backstroke: 'Rücken', breaststroke: 'Brust', butterfly: 'Delfin', drill: 'Technik', mixed: 'Lagen', im: 'Lagen' };

export async function renderActivity(root, ctx, id) {
  const a = ctx.model.byId.get(id);
  if (!a) { root.append(emptyNote('Aktivität nicht gefunden.')); return; }
  const th = ctx.model.thAt(a.day);
  const idx = ctx.model.acts.indexOf(a);
  const prev = ctx.model.acts[idx - 1], next = ctx.model.acts[idx + 1];

  root.append(h('div', { class: 'act-head' },
    h('div', { class: 'act-nav' },
      h('a', { href: '#/aktivitaeten', class: 'link-btn', text: '‹ Alle Aktivitäten' }),
      h('span', { class: 'spacer' }),
      prev ? h('a', { href: `#/a/${encodeURIComponent(prev.id)}`, class: 'link-btn', title: prev.name, text: '← Vorherige' }) : null,
      next ? h('a', { href: `#/a/${encodeURIComponent(next.id)}`, class: 'link-btn', title: next.name, text: 'Nächste →' }) : null),
    h('h1', { class: 'act-title', text: a.name }),
    h('div', { class: 'act-sub' }, sportTag(a),
      h('span', { text: `${F.dateLong(a.start)}, ${F.time(a.start)} Uhr` }),
      a.device ? h('span', { class: 'muted', text: a.device.replace(/^fr/, 'Forerunner ').replace(/^fenix/, 'fēnix ') }) : null)));

  root.append(statsGrid(a, th));

  const holder = h('div', { class: 'act-body' }, h('p', { class: 'muted', text: 'Lade Details …' }));
  root.append(holder);
  let d;
  try {
    d = await loadDetail(a.file);
  } catch (e) {
    holder.replaceChildren(emptyNote(`Details nicht ladbar: ${e.message}`));
    return;
  }
  if (!root.isConnected) return;
  holder.replaceChildren();
  const st = d.streams || { t: [] };

  // ---------------------------------------------------------- Karte + Verlauf
  let map = null;
  if (st.lat && st.lat.some(v => v != null)) {
    const pts = st.lat.map((la, i) => (la != null && st.lon[i] != null ? [la / 1e5, st.lon[i] / 1e5] : null));
    const mapHost = h('div', { class: 'map-host' });
    holder.append(card(null, mapHost, { cls: 'card-flush' }));
    map = routeMap(mapHost, pts);
    if (d.privacy_hidden) mapHost.append(h('div', { class: 'map-note', text: 'Abschnitte in Privatzonen ausgeblendet' }));
  }
  if (st.t.length > 1) holder.append(streamsCard(a, st, map, ctx));

  // ---------------------------------------------------------- Splits / Runden
  if (d.splits?.length > 1 && (a.cat === 'run' || a.cat === 'other' || a.cat === 'ride')) holder.append(splitsCard(a, d.splits));
  if (d.lengths?.length) holder.append(lengthsCard(a, d.lengths));
  if (d.sets?.length) holder.append(setsCard(d.sets));
  if (d.laps?.length > 1) holder.append(lapsCard(a, d.laps));

  // ---------------------------------------------------------- Zonen + Mean-Max
  const zoneCards = [];
  const addZones = (title, kind, hist, width, fmtB) => {
    const b = M.zoneBounds(kind, th);
    if (!hist || !b) return;
    const t = M.zoneTimes(hist, width, b);
    const names = M.ZONE_NAMES[kind];
    const zones = t.map((sec, i) => ({
      label: names[i],
      range: i === 0 ? `< ${fmtB(b[0])}` : i === b.length ? `≥ ${fmtB(b[i - 1])}` : `${fmtB(b[i - 1])}–${fmtB(b[i])}`,
      seconds: sec,
    }));
    const host = h('div');
    zoneBars(host, zones, i => zoneColor(i, names.length), s => F.duration(s, { short: true }));
    zoneCards.push(card(title, host));
  };
  addZones('Herzfrequenzzonen', 'hr', a.h_hr, 1, v => Math.round(v));
  if (a.cat === 'ride') addZones('Leistungszonen', 'pw', a.h_pw, 10, v => `${Math.round(v)} W`);
  if (a.cat === 'run') addZones('Pacezonen (steigungskorrigiert)', 'pace', a.h_gap || a.h_v, 0.1, v => F.pace(v, 1000, false));
  if (zoneCards.length) holder.append(h('div', { class: 'grid-2' }, zoneCards));

  const mm = mmCard(a, ctx);
  if (mm) holder.append(mm);
}

// ------------------------------------------------------------------ Kennzahlen

function statsGrid(a, th) {
  const items = [];
  const add = (l, v, s) => { if (v != null && v !== F.DASH) items.push(stat(l, v, s)); };
  if (a.dist && a.cat !== 'strength') add('Distanz', F.km(a.dist));
  add('Bewegungszeit', F.duration(a.moving), a.elapsed && a.elapsed - a.moving > 30 ? `gesamt ${F.duration(a.elapsed)}` : null);
  if (a.dist && a.cat !== 'strength') add(a.cat === 'ride' ? 'Ø Geschwindigkeit' : 'Ø Pace', speedOf(a),
    a.cat === 'ride' && a.v_max ? `max ${F.kmh(a.v_max)}` : null);
  if (a.cat === 'run' && a.gap) add('Ø GAP', F.pace(a.gap, 1000), a.ngp ? `NGP ${F.pace(a.ngp, 1000)}` : null);
  if (a.ascent != null && a.cat !== 'swim' && a.cat !== 'strength') add('Höhenmeter', `${F.num(a.ascent)} m`, a.descent != null ? `↓ ${F.num(a.descent)} m` : null);
  if (a.hr_avg) add('Ø Herzfrequenz', `${a.hr_avg} bpm`, a.hr_max ? `max ${a.hr_max} bpm` : null);
  if (a.pw_avg && a.cat === 'ride') {
    add('Ø Leistung', `${a.pw_avg} W`, a.pw_max ? `max ${a.pw_max} W` : null);
    if (a.np) add('Normalized Power', `${a.np} W`, `VI ${F.num(a.np / a.pw_avg, 2)}${th.weight ? ` · ${F.num(a.np / th.weight, 2)} W/kg` : ''}`);
    if (a.work_kj) add('Arbeit', `${F.num(a.work_kj)} kJ`);
  }
  if (a.cad_avg) add('Ø Kadenz', `${a.cad_avg} ${a.cat === 'run' ? 'spm' : 'rpm'}`);
  if (a.tss) add('Belastung', `${Math.round(a.tss)} TSS`, a.method + (a.IF ? ` · IF ${F.num(a.IF, 2)}` : ''));
  if (a.ef) add('Effizienzfaktor', F.num(a.ef, 2), a.cat === 'ride' ? 'NP / Ø HF' : 'NGP [m/min] / Ø HF');
  if (a.decoupling != null) add(a.cat === 'ride' ? 'Pw:HR-Drift' : 'Pa:HR-Drift', `${F.num(a.decoupling, 1)} %`, a.decoupling < 5 ? 'unter 5 %: aerob stabil' : 'Output/HF sinkt in 2. Hälfte');
  if (a.cat === 'swim') {
    if (a.pool) add('Becken', `${F.num(a.pool)} m`);
    if (a.strokes) add('Züge', F.num(a.strokes));
  }
  if (a.cat === 'strength') {
    if (a.sets) add('Sätze', a.sets);
    if (a.reps) add('Wiederholungen', a.reps);
    if (a.volume_kg) add('Volumen', `${F.num(a.volume_kg)} kg`);
  }
  if (a.te_aer) add('Training Effect', `${F.num(a.te_aer, 1)} aerob`, a.te_ana ? `${F.num(a.te_ana, 1)} anaerob` : null);
  if (a.kcal) add('Energie', `${F.num(a.kcal)} kcal`);
  return h('div', { class: 'stats-grid' }, items);
}

// ------------------------------------------------------------------ Verlauf

function streamsCard(a, st, map, ctx) {
  const n = st.t.length;
  const hasD = st.d && st.d.some(v => v != null);
  let axis = hasD && a.cat !== 'swim' ? ctx.prefs.get('act.axis', 'd') : 't';
  const host = h('div');
  const selInfo = h('div', { class: 'sel-info', text: 'Bereich im Diagramm ziehen, um ihn auszuwerten.' });

  // Pausen als Luecken: bei Zeitspruengen > 3 Anzeigeschritte einen Leerpunkt einfuegen
  const step = n > 1 ? (st.t[n - 1] - st.t[0]) / (n - 1) : 1;
  const gapIdx = [];
  for (let i = 1; i < n; i++) if (st.t[i] - st.t[i - 1] > Math.max(30, 4 * step)) gapIdx.push(i);
  const withGaps = arr => {
    if (!arr) return null;
    const out = [];
    let g = 0;
    for (let i = 0; i < n; i++) {
      if (gapIdx[g] === i) { out.push(null); g++; }
      out.push(arr[i]);
    }
    return out;
  };
  const srcIndex = [];
  { let g = 0; for (let i = 0; i < n; i++) { if (gapIdx[g] === i) { srcIndex.push(null); g++; } srcIndex.push(i); } }

  const ch = {};
  const isRunLike = a.cat === 'run' || a.sport === 'walking' || a.sport === 'hiking';
  if (st.v && a.cat !== 'swim') {
    if (isRunLike) {
      ch.speed = st.v.map(v => (v != null && v > 50 ? 1000 / (v / 100) : null));        // s/km
    } else ch.speed = st.v.map(v => (v != null ? (v / 100) * 3.6 : null));             // km/h
  }
  if (st.hr) ch.hr = st.hr;
  if (st.pw) ch.pw = st.pw;
  if (st.alt) ch.alt = st.alt.map(v => (v == null ? null : v / 10));
  if (st.cad) ch.cad = st.cad.map(v => (v == null ? null : isRunLike ? v * 2 : v));

  const q = (arr, p) => { const s = arr.filter(v => v != null).sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)]; };

  const draw = () => {
    const xsRaw = axis === 'd' ? st.d.map((v, i) => v ?? (i ? st.d[i - 1] : 0)) : st.t;
    // Leerpunkte bekommen denselben x-Wert wie ihr Nachfolger
    const xs = srcIndex.map((i, k) => xsRaw[i ?? srcIndex[k + 1]]);
    const panels = [];
    if (ch.speed) {
      if (isRunLike) {
        const lo = q(ch.speed, 0.02), hi = q(ch.speed, 0.95);
        panels.push({ label: 'Pace', height: 120, invert: true, domain: [Math.floor(lo / 30) * 30, Math.ceil(hi / 30) * 30],
          yFmt: v => F.pace(1000 / v, 1000, false),
          series: [{ label: 'Pace', color: 'var(--c-speed)', values: withGaps(ch.speed), fmt: v => `${F.pace(1000 / v, 1000, false)} /km` }] });
      } else {
        panels.push({ label: 'Geschwindigkeit', height: 110, zero: true, yFmt: v => F.num(v),
          series: [{ label: 'Geschwindigkeit', color: 'var(--c-speed)', values: withGaps(ch.speed), fmt: v => `${F.num(v, 1)} km/h` }] });
      }
    }
    if (ch.pw) panels.push({ label: 'Leistung', height: 110, zero: true, yFmt: v => F.num(v),
      series: [{ label: 'Leistung', color: 'var(--c-pw)', values: withGaps(ch.pw), fmt: v => `${Math.round(v)} W` }] });
    if (ch.hr) {
      const lo = q(ch.hr, 0.01), hi = q(ch.hr, 0.999);
      panels.push({ label: 'Herzfrequenz', height: 100, domain: [Math.floor((lo - 5) / 10) * 10, Math.ceil((hi + 3) / 10) * 10], yFmt: v => F.num(v),
        series: [{ label: 'Herzfrequenz', color: 'var(--c-hr)', values: withGaps(ch.hr), fmt: v => `${Math.round(v)} bpm` }] });
    }
    if (ch.alt) panels.push({ label: 'Höhe', height: 80, yFmt: v => `${F.num(v)}`,
      series: [{ label: 'Höhe', color: 'var(--c-alt)', values: withGaps(ch.alt), area: true, fmt: v => `${F.num(Math.round(v))} m` }] });
    if (ch.cad) {
      const lo = q(ch.cad, 0.05), hi = q(ch.cad, 0.995);
      panels.push({ label: 'Kadenz', height: 70, domain: [Math.max(0, Math.floor((lo - 10) / 10) * 10), Math.ceil((hi + 5) / 10) * 10], yFmt: v => F.num(v),
        series: [{ label: 'Kadenz', color: 'var(--c-cad)', values: withGaps(ch.cad), fmt: v => `${Math.round(v)} ${isRunLike ? 'spm' : 'rpm'}` }] });
    }
    if (!panels.length) { host.replaceChildren(emptyNote('Keine Messkanäle.')); return; }
    const xFmt = axis === 'd' ? v => `${F.num(v / 1000, 2)} km` : v => F.duration(v);
    const chart = lineChart(host, {
      x: xs, xFmt, panels, selectable: true,
      xTicks: axis === 't' ? (lo, hi, w) => timeTicks(lo, hi, w) : undefined,
      onHover: i => map?.mark(i == null ? null : srcIndex[i]),
      onSelect: r => {
        if (!r) { selInfo.textContent = 'Bereich im Diagramm ziehen, um ihn auszuwerten.'; map?.highlight(null); return; }
        const i0 = srcIndex[r[0]] ?? srcIndex[r[0] + 1], i1 = srcIndex[r[1]] ?? srcIndex[r[1] - 1];
        if (i0 == null || i1 == null || i1 <= i0) return;
        map?.highlight([i0, i1]);
        selInfo.replaceChildren(...selectionStats(a, st, i0, i1, isRunLike));
      },
    });
    host._chart = chart;
  };
  const actions = hasD && a.cat !== 'swim'
    ? segmented([['d', 'Distanz'], ['t', 'Zeit']], axis, v => { axis = v; ctx.prefs.set('act.axis', v); draw(); }, 'x-Achse')
    : null;
  const c = card('Verlauf', h('div', {}, selInfo, host), { actions });
  queueMicrotask(draw);
  return c;
}

function timeTicks(lo, hi, w) {
  const span = hi - lo;
  const cands = [60, 120, 300, 600, 900, 1200, 1800, 3600, 7200];
  const want = Math.max(2, Math.floor(w / 90));
  const step = cands.find(c => span / c <= want) || 7200;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push({ v, label: F.duration(v) });
  return out;
}

function selectionStats(a, st, i0, i1, isRunLike) {
  const avg = (arr, f = x => x) => {
    if (!arr) return null;
    let s = 0, n = 0;
    for (let i = i0; i <= i1; i++) if (arr[i] != null) { s += f(arr[i]); n++; }
    return n ? s / n : null;
  };
  const dt = st.t[i1] - st.t[i0];
  const dd = st.d ? (st.d[i1] ?? 0) - (st.d[i0] ?? 0) : null;
  const parts = [h('b', { text: 'Auswahl' }), ` ${F.duration(dt)}`];
  if (dd) parts.push(` · ${F.km(dd)}`, ` · ${isRunLike ? F.pace(dd / dt, 1000) : F.kmh(dd / dt)}`);
  const hr = avg(st.hr); if (hr) parts.push(` · Ø ${Math.round(hr)} bpm`);
  const pw = avg(st.pw); if (pw) parts.push(` · Ø ${Math.round(pw)} W`);
  if (st.alt) {
    let up = 0, ref = null;
    for (let i = i0; i <= i1; i++) {
      const v = st.alt[i]; if (v == null) continue;
      if (ref == null) ref = v; else if (v - ref >= 20) { up += v - ref; ref = v; } else if (ref - v >= 20) ref = v;
    }
    if (up) parts.push(` · ↑ ${F.num(Math.round(up / 10))} m`);
  }
  return parts;
}

// ------------------------------------------------------------------ Tabellen

function splitsCard(a, splits) {
  const isRide = a.cat === 'ride';
  const vs = splits.map(s => s.dist / s.dur);
  const vmax = Math.max(...vs), vmin = Math.min(...vs);
  const bar = v => h('span', { class: 'pace-bar' }, h('span', { style: { width: `${20 + 80 * ((v - vmin) / (vmax - vmin || 1))}%` } }));
  let cum = 0;
  const rows = splits.map((s, i) => ({ ...s, i: i + 1, v: s.dist / s.dur, cum: (cum += s.dist) }));
  return card(isRide ? 'Abschnitte (5 km)' : 'Splits (km)', table(rows, [
    { label: isRide ? 'km' : 'km', value: r => r.dist < (isRide ? 4990 : 990) ? F.num(r.cum / 1000, 2) : F.num(Math.round(r.cum / 1000)) },
    { label: 'Zeit', value: r => F.duration(r.dur), num: true },
    { label: isRide ? 'Tempo' : 'Pace', value: r => isRide ? F.kmh(r.v) : F.pace(r.v, 1000, false), num: true },
    { label: '', value: r => bar(r.v) },
    ...(a.cat === 'run' ? [{ label: 'GAP', value: r => r.gap ? F.pace(r.gap, 1000, false) : F.DASH, num: true }] : []),
    { label: 'Ø HF', value: r => r.hr ?? F.DASH, num: true },
    { label: 'Höhe', value: r => `+${r.up} / −${r.down}`, num: true },
  ]));
}

function lapsCard(a, laps) {
  const isRide = a.cat === 'ride', isSwim = a.cat === 'swim';
  const cols = [
    { label: '#', value: r => r.i },
    { label: 'Zeit', value: r => F.duration(r.dur), num: true },
    { label: 'Distanz', value: r => r.dist ? (isSwim ? `${F.num(r.dist)} m` : F.km(r.dist, 2)) : F.DASH, num: true },
    { label: isRide ? 'Tempo' : 'Pace', value: r => r.v ? (isRide ? F.kmh(r.v) : F.pace(r.v, isSwim ? 100 : 1000, false)) : F.DASH, num: true },
  ];
  if (laps.some(l => l.hr)) cols.push({ label: 'Ø HF', value: r => r.hr ?? F.DASH, num: true });
  if (laps.some(l => l.pw)) cols.push({ label: 'Ø W', value: r => r.pw ?? F.DASH, num: true }, { label: 'NP', value: r => r.np ?? F.DASH, num: true });
  if (laps.some(l => l.asc)) cols.push({ label: 'Hm', value: r => r.asc ?? F.DASH, num: true });
  return card('Runden', table(laps.map((l, i) => ({ ...l, i: i + 1 })), cols));
}

function lengthsCard(a, lengths) {
  const pool = a.pool || 25;
  const act = lengths.filter(l => l.active);
  const swolfOf = ls => { const w = ls.filter(l => l.strokes); return w.length ? w.reduce((x, l) => x + l.dur + l.strokes, 0) / w.length : null; };
  // Intervalle = zusammenhaengende aktive Bahnen zwischen Pausen
  const ivs = [];
  let cur = null;
  for (const l of lengths) {
    if (l.active) { if (!cur) { cur = { ls: [], rest: 0 }; ivs.push(cur); } cur.ls.push(l); }
    else if (cur) { cur.rest += l.dur || 0; cur = null; }
  }
  const strokeOf = ls => {
    const c = {};
    for (const l of ls) c[l.stroke] = (c[l.stroke] || 0) + 1;
    const k = Object.keys(c);
    return k.length > 1 ? 'Gemischt' : (STROKES[k[0]] || k[0] || F.DASH);
  };
  const rows = ivs.map((iv, i) => {
    const t = iv.ls.reduce((x, l) => x + (l.dur || 0), 0);
    return { i: i + 1, n: iv.ls.length, dist: iv.ls.length * pool, t, rest: iv.rest, stroke: strokeOf(iv.ls), swolf: swolfOf(iv.ls) };
  });
  const sw = swolfOf(act);
  const sub = `${act.length} Bahnen à ${F.num(pool)} m${sw ? ` · Ø SWOLF ${Math.round(sw)}` : ''}`;
  const all = h('details', { class: 'more' }, h('summary', { text: 'Alle Bahnen' }),
    table(act.map((l, i) => ({ ...l, n: i + 1 })), [
      { label: '#', value: r => r.n },
      { label: 'Zeit', value: r => F.duration(r.dur), num: true },
      { label: 'Pace', value: r => F.pace(pool / r.dur, 100, false), num: true },
      { label: 'Lage', value: r => STROKES[r.stroke] || r.stroke || F.DASH },
      { label: 'Züge', value: r => r.strokes ?? F.DASH, num: true },
      { label: 'SWOLF', value: r => r.strokes ? Math.round(r.dur + r.strokes) : F.DASH, num: true },
    ]));
  return card('Intervalle', h('div', {}, table(rows, [
    { label: '#', value: r => r.i },
    { label: 'Distanz', value: r => `${F.num(r.dist)} m`, num: true },
    { label: 'Zeit', value: r => F.duration(r.t), num: true },
    { label: 'Pace', value: r => F.pace(r.dist / r.t, 100, false), num: true },
    { label: 'Lage', value: r => r.stroke },
    { label: 'Ø SWOLF', value: r => r.swolf ? Math.round(r.swolf) : F.DASH, num: true },
    { label: 'Pause danach', value: r => r.rest ? F.duration(r.rest) : F.DASH, num: true },
  ]), all), { sub });
}

function setsCard(sets) {
  const name = ex => EXERCISES[ex] || (ex ? ex.replace(/_/g, ' ') : 'Übung');
  return card('Sätze', table(sets.map((x, i) => ({ ...x, i: i + 1 })), [
    { label: '#', value: r => r.i },
    { label: 'Übung', value: r => name(r.ex) },
    { label: 'Wdh.', value: r => r.reps ?? F.DASH, num: true },
    { label: 'Gewicht', value: r => r.kg ? `${F.num(r.kg, r.kg % 1 ? 1 : 0)} kg` : F.DASH, num: true },
    { label: 'Dauer', value: r => r.dur ? F.duration(r.dur) : F.DASH, num: true },
  ]));
}

// ------------------------------------------------------------------ Mean-Max

function mmCard(a, ctx) {
  const t0 = a.date;
  const from = M.dayKey(M.addDays(t0, -90));
  const peers = ctx.model.acts.filter(x => x.cat === a.cat && x.day >= from && x.day <= a.day);
  const host = h('div');
  if (a.cat === 'ride' && a.mm_pw) {
    const env = M.envelope(peers, 'mm_pw');
    curveChart(host, {
      x: M.DURATIONS, height: 240, xFmt: F.durLabel, yFmt: v => `${Math.round(v)} W`,
      series: [
        { label: 'Diese Fahrt', color: 'var(--c-s1)', values: a.mm_pw },
        { label: 'Beste 90 Tage davor', color: 'var(--c-prev1)', values: env.map(x => x?.v ?? null), meta: i => env[i] && F.dateShort(env[i].a.start), thin: true },
      ],
    });
    return card('Leistungskurve', host, { sub: 'Mean-Max dieser Fahrt im Vergleich' });
  }
  if (a.cat === 'run' && a.mm_v) {
    const env = M.envelope(peers, 'mm_v');
    const p = arr => arr.map((v, i) => (v && v > 0.5 && M.DURATIONS[i] >= 30 ? 1000 / v : null));
    const own = p(a.mm_v), best = p(env.map(x => x?.v ?? null));
    const vals = [...own, ...best].filter(v => v != null);
    if (!vals.length) return null;
    curveChart(host, {
      x: M.DURATIONS, height: 240, invert: true, xFmt: F.durLabel, yFmt: v => `${F.pace(1000 / v, 1000, false)} /km`,
      domain: [Math.floor(Math.min(...vals) / 15) * 15, Math.ceil(Math.max(...vals) / 15) * 15 + 15],
      series: [
        { label: 'Dieser Lauf', color: 'var(--c-s1)', values: own },
        { label: 'Beste 90 Tage davor', color: 'var(--c-prev1)', values: best, meta: i => env[i] && F.dateShort(env[i].a.start), thin: true },
      ],
    });
    return card('Pace-Kurve', host, { sub: 'Schnellste mittlere Pace je Dauer' });
  }
  return null;
}
