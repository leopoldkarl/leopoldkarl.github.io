// format.js — Zahlen, Zeiten, Einheiten (de-AT).

const nf = new Map();
function num(v, digits = 0) {
  if (!nf.has(digits)) {
    nf.set(digits, new Intl.NumberFormat('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return nf.get(digits).format(v);
}
export { num };

export const DASH = '–';

export function duration(s, { short = false } = {}) {
  if (s == null || !isFinite(s)) return DASH;
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (short) return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function hours(s) {
  if (s == null) return DASH;
  return `${num(s / 3600, s < 36000 ? 1 : 0)} h`;
}

export function km(m, digits) {
  if (m == null) return DASH;
  const d = digits ?? (m < 10000 ? 2 : m < 100000 ? 1 : 0);
  return `${num(m / 1000, d)} km`;
}

export function meters(m) {
  return m == null ? DASH : `${num(m)} m`;
}

// Pace aus m/s: per = 1000 (Laufen) bzw. 100 (Schwimmen)
export function pace(v, per = 1000, unit = true) {
  if (!v || v <= 0.05) return DASH;
  const s = per / v;
  if (s > 5999) return DASH;
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  const txt = sec === 60 ? `${m + 1}:00` : `${m}:${String(sec).padStart(2, '0')}`;
  return unit ? `${txt} /${per === 1000 ? 'km' : '100 m'}` : txt;
}

export function kmh(v, unit = true) {
  if (v == null) return DASH;
  return unit ? `${num(v * 3.6, 1)} km/h` : num(v * 3.6, 1);
}

// Geschwindigkeit in der fuer die Sportart ueblichen Form
export function speedFor(cat, v, unit = true) {
  if (cat === 'run' || cat === 'other_foot') return pace(v, 1000, unit);
  if (cat === 'swim') return pace(v, 100, unit);
  return kmh(v, unit);
}

export function speedLabel(cat) {
  return cat === 'run' ? 'Pace' : cat === 'swim' ? 'Pace' : 'Geschwindigkeit';
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jän.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const MONL = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export { MON, MONL };

// "2026-09-23T07:15:00" -> Date in lokaler Wanduhrzeit (ohne Zeitzonenumrechnung)
export function localDate(iso) {
  const [d, t = '00:00:00'] = iso.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi, s || 0);
}

export function dateLong(iso) {
  const d = localDate(iso);
  return `${WD[d.getDay()]}, ${d.getDate()}. ${MONL[d.getMonth()]} ${d.getFullYear()}`;
}

export function dateShort(iso) {
  const d = localDate(iso);
  return `${d.getDate()}. ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

export function dateTiny(d) {
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

export function time(iso) {
  return iso.slice(11, 16);
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function signed(v, digits = 0) {
  if (v == null) return DASH;
  const s = num(Math.abs(v), digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function durLabel(s) {
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s / 60} min`;
  return s % 3600 ? `${num(s / 3600, 1)} h` : `${s / 3600} h`;
}

export function distLabel(m) {
  const named = { 1609: '1 Meile', 21097: 'Halbmarathon', 42195: 'Marathon', 160934: '100 Meilen' };
  if (named[m]) return named[m];
  return m < 1000 ? `${m} m` : `${num(m / 1000, m % 1000 ? 1 : 0)} km`;
}
