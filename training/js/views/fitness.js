// Fitness: Performance Management Chart, Wochenbelastung, Zeit in HF-Zonen,
// Schwellenwerte.

import { h, lineChart, barChart } from '../charts.js';
import * as F from '../format.js';
import * as M from '../model.js';
import { card, segmented, catColor, table, zoneColor } from '../ui.js';
import { formLabel } from './overview.js';

export function renderFitness(root, ctx) {
  const { model, acts, prefs, filtered } = ctx;
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // ---------------------------------------------------------- PMC
  const pmcHost = h('div');
  const pmcInfo = h('div', { class: 'pmc-now' });
  const drawPMC = () => {
    const range = prefs.get('fit.range', 180);
    const from = range === 'all' ? (model.acts[0]?.date || t0) : M.addDays(t0, -range);
    // PMC nach Sportartfilter: bei Auswahl nur deren Belastung
    const p = M.pmc(acts, from, t0);
    const xs = p.days.map(d => d.getTime());
    const last = p.ctl.length - 1;
    const ramp = last >= 7 ? p.ctl[last] - p.ctl[last - 7] : null;
    pmcInfo.replaceChildren(
      h('div', {}, h('b', { text: F.num(Math.round(p.ctl[last] || 0)) }), ' Fitness (CTL)'),
      h('div', {}, h('b', { text: F.num(Math.round(p.atl[last] || 0)) }), ' Ermüdung (ATL)'),
      h('div', {}, h('b', { text: F.signed(Math.round((p.ctl[last] || 0) - (p.atl[last] || 0))) }), ` Form (TSB, morgen) · ${formLabel((p.ctl[last] || 0) - (p.atl[last] || 0))}`),
      h('div', {}, h('b', { text: ramp == null ? F.DASH : F.signed(ramp, 1) }), ' CTL-Anstieg / 7 Tage'));
    const dFmt = v => { const d = new Date(v); return `${F.dateTiny(d)}${d.getFullYear()}`; };
    lineChart(pmcHost, {
      x: xs,
      xFmt: dFmt,
      xTicks: (lo, hi, w) => monthTicks(lo, hi, w),
      panels: [
        { label: 'Fitness & Ermüdung', height: 200, zero: true, yFmt: v => F.num(Math.round(v)),
          series: [
            { label: 'Fitness (CTL)', color: 'var(--c-ctl)', values: p.ctl, area: false },
            { label: 'Ermüdung (ATL)', color: 'var(--c-atl)', values: p.atl, thin: true },
          ] },
        { label: 'Form (TSB)', height: 90, refLine: 0, yFmt: v => F.signed(Math.round(v)),
          series: [{ label: 'Form (TSB)', color: 'var(--c-tsb)', values: p.tsb, area: true }] },
        { label: 'Tages-TSS', height: 80, zero: true, yFmt: v => F.num(Math.round(v)),
          series: [{ label: 'TSS', color: 'var(--c-tss)', values: p.tss, bars: true }] },
      ],
    });
  };
  root.append(card('Performance Management', h('div', {}, pmcInfo, pmcHost), {
    sub: filtered ? 'Nur die gewählten Sportarten' : 'Alle Sportarten',
    actions: segmented([[42, '6 W'], [90, '3 M'], [180, '6 M'], [365, '1 J'], ['all', 'Alles']],
      prefs.get('fit.range', 180), v => { prefs.set('fit.range', v); drawPMC(); }, 'Zeitraum'),
  }));
  drawPMC();

  // ---------------------------------------------------------- Wochen-TSS & HF-Zonen
  const weeks = 16;
  const wk0 = M.addDays(M.startOfWeek(t0), -7 * (weeks - 1));
  const labels = [], titles = [];
  for (let i = 0; i < weeks; i++) {
    const d = M.addDays(wk0, 7 * i);
    labels.push(F.dateTiny(d)); titles.push(`Woche ab ${F.dateTiny(d)}${d.getFullYear()}`);
  }
  const tssStacks = M.CATS.map(c => ({ label: M.CAT_LABEL[c], color: catColor(c), values: new Array(weeks).fill(0) }));
  const zoneStacks = M.ZONE_NAMES.hr.map((n, i) => ({ label: n, color: zoneColor(i, 5), values: new Array(weeks).fill(0) }));
  for (const a of acts) {
    const i = Math.floor(M.dayDiff(wk0, a.date) / 7);
    if (i < 0 || i >= weeks) continue;
    tssStacks[M.CATS.indexOf(a.cat)].values[i] += a.tss || 0;
    const th = model.thAt(a.day);
    const zt = M.zoneTimes(a.h_hr, 1, M.zoneBounds('hr', th));
    if (zt) zt.forEach((sec, z) => { zoneStacks[z].values[i] += sec; });
  }
  const grid = h('div', { class: 'grid-2' });
  const tssHost = h('div'), zHost = h('div');
  grid.append(card('Belastung pro Woche', tssHost, { sub: 'TSS, letzte 16 Wochen' }),
    card('Zeit in HF-Zonen pro Woche', zHost, { sub: 'Zonen nach % der Laktatschwellen-HF (Friel)' }));
  root.append(grid);
  barChart(tssHost, { labels, stacks: tssStacks, height: 220, yFmt: v => F.num(Math.round(v)), title: i => titles[i] });
  for (const st of zoneStacks) st.values = st.values.map(v => v / 3600);
  barChart(zHost, { labels, stacks: zoneStacks, height: 220, yFmt: v => `${F.num(v)} h`, tipFmt: v => F.duration(v * 3600, { short: true }), title: i => titles[i] });

  // ---------------------------------------------------------- Schwellen
  const th = model.thAt(M.dayKey(t0));
  const row = (label, key, fmt) => ({ label, value: th[key] != null ? fmt(th[key]) : F.DASH, src: th.src[key] || 'fehlt' });
  const rows = [
    row('FTP (Rad)', 'ftp', v => `${Math.round(v)} W${th.weight ? ` · ${F.num(v / th.weight, 2)} W/kg` : ''}`),
    row('Laktatschwellen-HF', 'lthr', v => `${Math.round(v)} bpm`),
    row('Maximale HF', 'hr_max', v => `${Math.round(v)} bpm`),
    row('Ruhe-HF', 'hr_rest', v => `${Math.round(v)} bpm`),
    row('Schwellenpace (Laufen)', 'run_v', v => F.pace(v, 1000)),
    row('CSS (Schwimmen)', 'swim_v', v => F.pace(v, 100)),
    row('Gewicht', 'weight', v => `${F.num(v, 1)} kg`),
  ];
  root.append(card('Schwellenwerte', h('div', {},
    table(rows, [
      { label: 'Größe', value: r => r.label },
      { label: 'Wert', value: r => r.value, num: true },
      { label: 'Quelle', value: r => r.src },
    ]),
    h('p', { class: 'note', text: 'Werte „ab Datum“ stammen aus der config.json des Sync-Skripts und gelten ab diesem Tag; ' +
      '„geschätzt“ heißt: aus den Daten der letzten 12 Monate abgeleitet (FTP ≈ 95 % der besten 20-min-Leistung, ' +
      'LTHR ≈ beste 20-min-HF, CSS aus besten 200 m und 400 m). Schätzungen sind grob — eingetragene Werte sind besser.' })),
  { sub: `Heute gültig · Belastung wird mit den am jeweiligen Tag gültigen Werten berechnet` }));

  root.append(card('Wie die Belastung berechnet wird', h('ul', { class: 'method' },
    h('li', { text: 'Rad mit Leistungsmesser: TSS = Stunden · IF² · 100 mit IF = NP / FTP.' }),
    h('li', { text: 'Laufen: rTSS = Stunden · IF² · 100 mit IF = NGP / Schwellengeschwindigkeit; NGP aus steigungskorrigierter Geschwindigkeit (Minetti-Kostenfunktion).' }),
    h('li', { text: 'Schwimmen: sTSS = Stunden · IF³ · 100 mit IF = Geschwindigkeit / CSS.' }),
    h('li', { text: 'Sonst: hrTSS = TRIMP / TRIMP(60 min an der LTHR) · 100 (Banister-TRIMP, eigene Normierung).' }),
    h('li', { text: 'CTL und ATL: exponentiell gleitende Mittel des Tages-TSS mit 42 bzw. 7 Tagen Zeitkonstante; TSB = CTL − ATL des Vortags.' }))));
}

function monthTicks(lo, hi, w) {
  const out = [];
  const a = new Date(lo), b = new Date(hi);
  const span = (hi - lo) / 86400000;
  const step = span > 800 ? 6 : span > 400 ? 3 : span > 150 ? 1 : 0;
  if (step === 0) {
    for (let d = new Date(a.getFullYear(), a.getMonth(), a.getDate()); d <= b; d = M.addDays(d, 1)) {
      if (d.getDay() === 1 && (w > 500 || d.getDate() <= 7 || d.getDate() > 14 && d.getDate() <= 21)) out.push({ v: d.getTime(), label: F.dateTiny(d) });
    }
    return out;
  }
  for (let d = new Date(a.getFullYear(), a.getMonth() + 1, 1); d <= b; d = new Date(d.getFullYear(), d.getMonth() + step, 1)) {
    out.push({ v: d.getTime(), label: d.getMonth() === 0 ? String(d.getFullYear()) : F.MON[d.getMonth()] });
  }
  if (w < 500) return out.filter((_, i) => i % 2 === 0);
  return out;
}
export { monthTicks };
