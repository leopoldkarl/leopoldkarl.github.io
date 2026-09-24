// Bestleistungen: Leistungskurve (Rad), Bestzeiten und Pace-Kurve (Laufen),
// Bestzeiten Schwimmen.

import { h, curveChart } from '../charts.js';
import * as F from '../format.js';
import * as M from '../model.js';
import { card, segmented, table, emptyNote } from '../ui.js';

const RUN_D = ['400', '1000', '1609', '3000', '5000', '10000', '15000', '21097', '30000', '42195'];
const RIDE_D = ['5000', '10000', '20000', '40000', '50000', '100000', '160934'];
const SWIM_D = ['100', '200', '400', '800', '1000', '1500', '1900', '3800'];
const KEY_DUR = [5, 15, 60, 300, 1200, 3600];

export function renderRecords(root, ctx) {
  const { acts, prefs } = ctx;
  const has = c => acts.some(a => a.cat === c);
  const sports = [['ride', 'Rad'], ['run', 'Laufen'], ['swim', 'Schwimmen']].filter(([c]) => has(c));
  if (!sports.length) { root.append(emptyNote('Für diese Auswahl gibt es keine Bestleistungen.')); return; }
  let sport = prefs.get('rec.sport', sports[0][0]);
  if (!has(sport)) sport = sports[0][0];
  const body = h('div');
  root.append(h('div', { class: 'view-head' },
    segmented(sports, sport, v => { prefs.set('rec.sport', v); draw(v); }, 'Sportart')), body);

  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d90 = M.dayKey(M.addDays(t0, -90));
  const y0 = `${t0.getFullYear()}-01-01`;
  const link = a => h('a', { href: `#/a/${encodeURIComponent(a.id)}`, text: F.dateShort(a.start) });

  function draw(sp) {
    body.replaceChildren();
    const list = acts.filter(a => a.cat === sp);
    const recent = list.filter(a => a.day >= d90);
    const thisYear = list.filter(a => a.day >= y0);

    if (sp === 'ride') {
      const withPw = list.filter(a => a.mm_pw);
      if (withPw.length) {
        const all = M.envelope(withPw, 'mm_pw'), r90 = M.envelope(recent, 'mm_pw'), yr = M.envelope(thisYear, 'mm_pw');
        const th = ctx.model.thAt(M.dayKey(t0));
        const kg = th.weight;
        const host = h('div');
        body.append(card('Leistungskurve', host, { sub: 'Beste mittlere Leistung je Dauer (Mean-Max)' }));
        curveChart(host, {
          x: M.DURATIONS, height: 280,
          xFmt: F.durLabel, yFmt: v => `${Math.round(v)} W${kg ? ` · ${F.num(v / kg, 1)}` : ''}`,
          series: [
            { label: 'Letzte 90 Tage', color: 'var(--c-s1)', values: r90.map(x => x?.v ?? null), meta: i => r90[i] && F.dateShort(r90[i].a.start) },
            { label: String(t0.getFullYear()), color: 'var(--c-s2)', values: yr.map(x => x?.v ?? null), meta: i => yr[i] && F.dateShort(yr[i].a.start), thin: true },
            { label: 'Gesamt', color: 'var(--c-prev1)', values: all.map(x => x?.v ?? null), meta: i => all[i] && F.dateShort(all[i].a.start), thin: true },
          ],
          onClick: i => { const x = r90[i] || all[i]; if (x) location.hash = `#/a/${encodeURIComponent(x.a.id)}`; },
        });
        const idx = d => M.DURATIONS.indexOf(d);
        body.append(card('Leistungs-Bestwerte', table(KEY_DUR.map(d => ({ d, all: all[idx(d)], r90: r90[idx(d)], yr: yr[idx(d)] })), [
          { label: 'Dauer', value: r => F.durLabel(r.d) },
          { label: 'Gesamt', value: r => r.all ? `${Math.round(r.all.v)} W${kg ? ` (${F.num(r.all.v / kg, 2)} W/kg)` : ''}` : F.DASH, num: true },
          { label: 'am', value: r => r.all ? link(r.all.a) : F.DASH },
          { label: String(t0.getFullYear()), value: r => r.yr ? `${Math.round(r.yr.v)} W` : F.DASH, num: true },
          { label: '90 Tage', value: r => r.r90 ? `${Math.round(r.r90.v)} W` : F.DASH, num: true },
        ])));
      } else {
        body.append(card('Leistungskurve', emptyNote('Keine Radaktivitäten mit Leistungsmesser.')));
      }
      body.append(distanceTable('Schnellste Abschnitte', list, RIDE_D, recent, thisYear, t => F.kmh(0), (t, d) => F.kmh(d / t), link, t0));
    }

    if (sp === 'run') {
      body.append(distanceTable('Bestzeiten', list, RUN_D, recent, thisYear, null, (t, d) => F.pace(d / t, 1000), link, t0));
      const all = M.envelope(list, 'mm_v'), r90 = M.envelope(recent, 'mm_v');
      const toPace = e => e.map(x => (x && x.v > 0.5 ? 1000 / x.v : null));
      const host = h('div');
      body.append(card('Pace-Kurve', host, { sub: 'Schnellste mittlere Geschwindigkeit je Dauer (GPS, ungeglättet)' }));
      const vals = toPace(all).filter((v, i) => v != null && M.DURATIONS[i] >= 30);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      curveChart(host, {
        x: M.DURATIONS, height: 260, invert: true,
        domain: vals.length ? [Math.floor(lo / 15) * 15, Math.ceil(hi / 15) * 15 + 15] : undefined,
        xFmt: F.durLabel, yFmt: v => `${F.pace(1000 / v, 1000, false)} /km`,
        series: [
          { label: 'Letzte 90 Tage', color: 'var(--c-s1)', values: toPace(r90).map((v, i) => M.DURATIONS[i] < 30 ? null : v), meta: i => r90[i] && F.dateShort(r90[i].a.start) },
          { label: 'Gesamt', color: 'var(--c-prev1)', values: toPace(all).map((v, i) => M.DURATIONS[i] < 30 ? null : v), meta: i => all[i] && F.dateShort(all[i].a.start), thin: true },
        ],
      });
    }

    if (sp === 'swim') {
      body.append(distanceTable('Bestzeiten', list, SWIM_D, recent, thisYear, null, (t, d) => F.pace(d / t, 100), link, t0));
      const est = ctx.model.est.swim_v;
      if (est) body.append(h('p', { class: 'note', text: `Aus den Bestzeiten über 200 m und 400 m geschätzte CSS: ${F.pace(est, 100)}.` }));
    }
  }
  draw(sport);
}

function distanceTable(title, list, dists, recent, thisYear, _u, paceFmt, link, t0) {
  const rows = dists.map(d => ({
    d: +d,
    all: M.bestTimes(list, d, 3),
    yr: M.bestTimes(thisYear, d, 1)[0],
    r90: M.bestTimes(recent, d, 1)[0],
  })).filter(r => r.all.length);
  if (!rows.length) return card(title, emptyNote('Noch keine Daten.'));
  return card(title, table(rows, [
    { label: 'Distanz', value: r => F.distLabel(r.d) },
    { label: 'Bestzeit', value: r => h('b', { text: F.duration(r.all[0].t) }), num: true },
    { label: 'Tempo', value: r => paceFmt(r.all[0].t, r.d), num: true },
    { label: 'am', value: r => link(r.all[0].a) },
    { label: String(t0.getFullYear()), value: r => r.yr ? F.duration(r.yr.t) : F.DASH, num: true },
    { label: '90 Tage', value: r => r.r90 ? F.duration(r.r90.t) : F.DASH, num: true },
    { label: '2. / 3.', value: r => r.all.slice(1).map(x => F.duration(x.t)).join(' · ') || F.DASH, num: true },
  ]), { sub: 'Schnellster zusammenhängender Abschnitt innerhalb einer Aktivität (Bewegungszeit)' });
}
