// model.js — alle schwellenabhaengigen Groessen. Reine Funktionen, kein DOM.
//
// Definitionen (Status in README.md, Abschnitt "Kennzahlen"):
//   Leistungs-TSS  = t · NP · IF / (FTP · 3600) · 100,  IF = NP / FTP       (Coggan)
//   rTSS           = h · IF² · 100,  IF = NGP / Schwellengeschwindigkeit
//   sTSS           = h · IF³ · 100,  IF = v / CSS
//   hrTSS          = TRIMP / TRIMP(60 min an der LTHR) · 100                (eigene Normierung)
//   CTL/ATL        = exponentiell gleitende Mittel des Tages-TSS, τ = 42 bzw. 7 Tage
//   TSB (Form)     = CTL(gestern) − ATL(gestern)

export const DURATIONS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420,
  600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400, 18000];

export const CATS = ['run', 'ride', 'swim', 'strength', 'other'];
export const CAT_LABEL = { run: 'Laufen', ride: 'Radfahren', swim: 'Schwimmen', strength: 'Kraft', other: 'Sonstiges' };

const HR_Z = [0.85, 0.90, 0.95, 1.00];                    // Friel, % LTHR
const PW_Z = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];        // Coggan, % FTP
const PACE_Z = [0.775, 0.877, 0.943, 1.01];               // ~Friel-Pacezonen, als Anteil der Schwellengeschwindigkeit
export const ZONE_NAMES = {
  hr: ['Z1 Erholung', 'Z2 Grundlage', 'Z3 Tempo', 'Z4 Schwelle', 'Z5 VO₂max+'],
  pw: ['Z1 Aktive Erholung', 'Z2 Ausdauer', 'Z3 Tempo', 'Z4 Schwelle', 'Z5 VO₂max', 'Z6 Anaerob', 'Z7 Neuromuskulär'],
  pace: ['Z1 Erholung', 'Z2 Grundlage', 'Z3 Tempo', 'Z4 Schwelle', 'Z5 VO₂max+'],
};

// ------------------------------------------------------------------ Datum

export function parseLocal(iso) {
  const [d, t = '00:00:00'] = iso.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi, s || 0);
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
}

export function startOfWeek(d) {               // Montag
  const wd = (d.getDay() + 6) % 7;
  return addDays(d, -wd);
}

export function dayDiff(a, b) {                // ganze Kalendertage b - a
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

// ------------------------------------------------------------------ Schwellen

// Schaetzungen aus den Daten der letzten 365 Tage vor der juengsten Aktivitaet.
export function estimate(acts) {
  if (!acts.length) return {};
  const last = acts[acts.length - 1].ts;
  const recent = acts.filter(a => a.ts > last - 365 * 86400);
  const i20 = DURATIONS.indexOf(1200), i60 = DURATIONS.indexOf(3600), i30 = DURATIONS.indexOf(1800);
  const est = {};
  const mm = (list, key, i) => Math.max(0, ...list.map(a => a[key]?.[i] ?? 0));
  const p20 = mm(recent, 'mm_pw', i20);
  if (p20 > 0) est.ftp = Math.round(0.95 * p20);
  const hrMaxes = recent.map(a => a.hr_max).filter(v => v && v < 225).sort((x, y) => x - y);
  if (hrMaxes.length) est.hr_max = hrMaxes[hrMaxes.length - 1];
  const endu = recent.filter(a => a.cat === 'run' || a.cat === 'ride');
  const h20 = mm(endu, 'mm_hr', i20);
  if (h20 > 0) est.lthr = Math.round(h20);
  const runs = recent.filter(a => a.cat === 'run');
  const v = Math.max(mm(runs, 'mm_v', i60), 0.95 * mm(runs, 'mm_v', i30), 0.92 * mm(runs, 'mm_v', i20));
  if (v > 0) est.run_v = +v.toFixed(3);
  // CSS aus den besten 200 m und 400 m
  const best = d => Math.min(Infinity, ...recent.filter(a => a.cat === 'swim').map(a => a.best?.[d] ?? Infinity));
  const t200 = best('200'), t400 = best('400');
  if (isFinite(t200) && isFinite(t400) && t400 > t200) est.swim_v = +(200 / (t400 - t200)).toFixed(3);
  est.hr_rest = 50;
  return est;
}

export function thresholdResolver(configured, est) {
  const list = [...(configured || [])].sort((a, b) => a.from.localeCompare(b.from));
  const keys = ['ftp', 'lthr', 'hr_max', 'hr_rest', 'run_v', 'swim_v', 'weight'];
  const cache = new Map();
  return function at(day) {
    if (cache.has(day)) return cache.get(day);
    const out = { src: {} };
    for (const k of keys) {
      if (est[k] != null) { out[k] = est[k]; out.src[k] = 'geschätzt'; }
    }
    for (const t of list) {
      if (t.from > day) break;
      for (const k of keys) if (t[k] != null) { out[k] = t[k]; out.src[k] = `ab ${t.from}`; }
    }
    cache.set(day, out);
    return out;
  };
}

// ------------------------------------------------------------------ Belastung

function trimpFactor(bpm, th) {
  const rest = th.hr_rest ?? 50, max = th.hr_max ?? 190;
  const x = Math.max(0, Math.min(1.2, (bpm - rest) / (max - rest)));
  return x * 0.64 * Math.exp(1.92 * x);
}

export function hrTSS(h, th) {
  if (!h || !th.lthr) return null;
  let trimp = 0;
  for (let i = 1; i < h.length; i++) {
    if (h[i]) trimp += (h[i] / 60) * trimpFactor(h[0] + i - 1, th);     // HF ist ganzzahlig: Klasse k = k bpm
  }
  const ref = 60 * trimpFactor(th.lthr, th);
  return ref > 0 ? (trimp / ref) * 100 : null;
}

export function load(a, th) {
  const hrs = (a.moving || a.elapsed || 0) / 3600;
  if (a.cat === 'ride' && a.np && th.ftp) {
    const IF = a.np / th.ftp;
    return { tss: hrs * IF * IF * 100, IF, method: 'Leistung' };
  }
  if (a.cat === 'run' && a.ngp && th.run_v) {
    const IF = a.ngp / th.run_v;
    return { tss: hrs * IF * IF * 100, IF, method: 'Pace (rTSS)' };
  }
  if (a.cat === 'swim' && a.v_avg && th.swim_v) {
    const IF = a.v_avg / th.swim_v;
    return { tss: hrs * IF ** 3 * 100, IF, method: 'Schwimmen (sTSS)' };
  }
  const t = hrTSS(a.h_hr, th);
  if (t != null) return { tss: t, IF: null, method: 'Herzfrequenz (hrTSS)' };
  return { tss: 0, IF: null, method: 'keine Daten' };
}

export function efficiency(a) {
  if (!a.hr_avg) return null;
  if (a.cat === 'ride' && a.np) return a.np / a.hr_avg;
  if (a.cat === 'run' && a.ngp) return (a.ngp * 60) / a.hr_avg;       // m/min pro Schlag
  return null;
}

// ------------------------------------------------------------------ Zonen

export function zoneBounds(kind, th) {
  if (kind === 'hr' && th.lthr) return HR_Z.map(f => f * th.lthr);
  if (kind === 'pw' && th.ftp) return PW_Z.map(f => f * th.ftp);
  if (kind === 'pace' && th.run_v) return PACE_Z.map(f => f * th.run_v);
  return null;
}

// Sekunden je Zone aus einem Histogramm [k0, c...] mit Klassenbreite width
export function zoneTimes(h, width, bounds) {
  if (!h || !bounds) return null;
  const out = new Array(bounds.length + 1).fill(0);
  for (let i = 1; i < h.length; i++) {
    if (!h[i]) continue;
    const v = (h[0] + i - 1 + (width === 1 ? 0 : 0.5)) * width;
    let z = 0;
    while (z < bounds.length && v >= bounds[z]) z++;
    out[z] += h[i];
  }
  return out;
}

export const HIST_WIDTH = { h_hr: 1, h_pw: 10, h_v: 0.1, h_gap: 0.1 };

// ------------------------------------------------------------------ Modell

export function buildModel(index) {
  const acts = index.activities.map(a => {
    const date = parseLocal(a.start);
    return { ...a, date, day: dayKey(date) };
  }).sort((x, y) => x.ts - y.ts);
  const est = estimate(acts);
  const configured = index.athlete?.thresholds || [];
  const thAt = thresholdResolver(configured, est);
  for (const a of acts) {
    const th = thAt(a.day);
    Object.assign(a, load(a, th));
    a.ef = efficiency(a);
  }
  const byId = new Map(acts.map(a => [a.id, a]));
  return { acts, byId, est, configured, thAt, generated: index.generated };
}

// ------------------------------------------------------------------ Aggregate

export function sum(list, f) {
  let s = 0;
  for (const x of list) s += f(x) || 0;
  return s;
}

export function periodStats(acts) {
  return {
    count: acts.length,
    time: sum(acts, a => a.moving),
    dist: sum(acts, a => a.dist),
    ascent: sum(acts, a => a.ascent),
    tss: sum(acts, a => a.tss),
  };
}

export function inRange(acts, from, to) {        // Date, Date (to exklusiv)
  const f = dayKey(from), t = dayKey(to);
  return acts.filter(a => a.day >= f && a.day < t);
}

// PMC ueber [from, to] (Date, inklusive). Die Rekursion beginnt am ersten
// Aktivitaetstag, damit CTL am Anfang des Fensters eingeschwungen ist.
export function pmc(acts, from, to) {
  const daily = new Map();
  for (const a of acts) daily.set(a.day, (daily.get(a.day) || 0) + (a.tss || 0));
  if (!acts.length) return { days: [], tss: [], ctl: [], atl: [], tsb: [] };
  const kC = 1 - Math.exp(-1 / 42), kA = 1 - Math.exp(-1 / 7);
  let d = acts[0].date < from ? new Date(acts[0].date) : new Date(from);
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let ctl = 0, atl = 0;
  const out = { days: [], tss: [], ctl: [], atl: [], tsb: [] };
  const fromK = dayKey(from), toK = dayKey(to);
  for (let key = dayKey(d); key <= toK; d = addDays(d, 1), key = dayKey(d)) {
    const t = daily.get(key) || 0;
    const tsb = ctl - atl;
    ctl += (t - ctl) * kC;
    atl += (t - atl) * kA;
    if (key >= fromK) {
      out.days.push(new Date(d));
      out.tss.push(t);
      out.ctl.push(ctl);
      out.atl.push(atl);
      out.tsb.push(tsb);
    }
  }
  return out;
}

// Mean-Max-Huelle ueber mehrere Aktivitaeten
export function envelope(acts, key) {
  const best = DURATIONS.map(() => null);
  for (const a of acts) {
    const mm = a[key];
    if (!mm) continue;
    mm.forEach((v, i) => {
      if (v != null && (best[i] == null || v > best[i].v)) best[i] = { v, a };
    });
  }
  return best;
}

// Bestzeiten je Distanz: sortierte Liste {t, a}
export function bestTimes(acts, dist, n = 3) {
  return acts.filter(a => a.best?.[dist] != null)
    .map(a => ({ t: a.best[dist], a }))
    .sort((x, y) => x.t - y.t)
    .slice(0, n);
}
