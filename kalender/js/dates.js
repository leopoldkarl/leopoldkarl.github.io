// dates.js — Datums-Helfer.
//
// Konvention: Alle Zeitpunkte werden als "wall clock" in der lokalen Zeitzone
// des Geraets gefuehrt (Strings 'YYYY-MM-DD' bzw. 'YYYY-MM-DDTHH:MM', ohne
// Zeitzonen-Suffix). Das vermeidet die gesamte UTC/DST-Umrechnungsklasse von
// Fehlern, hat aber die bewusste Konsequenz: reist man in eine andere
// Zeitzone, bleiben Termine auf ihrer Wanduhrzeit stehen.

export const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONTH_NAMES = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTH_SHORT = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' (lokale Komponenten, nicht UTC). */
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date -> 'HH:MM'. */
export function hm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Date -> 'YYYY-MM-DDTHH:MM'. */
export function ymdhm(d) {
  return `${ymd(d)}T${hm(d)}`;
}

/** 'YYYY-MM-DD' -> Date (lokale Mitternacht). */
export function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 'YYYY-MM-DD' oder 'YYYY-MM-DDTHH:MM' -> Date (lokal). */
export function parseLocal(s) {
  const str = String(s);
  const [datePart, timePart = '00:00'] = str.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mi] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mi || 0, 0, 0);
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return x;
}

export function addMinutes(d, n) {
  return new Date(d.getTime() + n * 60000);
}

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

export function addMonths(d, n) {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const day = Math.min(d.getDate(), daysInMonth(targetY, targetM));
  return new Date(targetY, targetM, day);
}

/** ISO-Wochentag: Montag = 0 ... Sonntag = 6. */
export function isoDow(d) {
  return (d.getDay() + 6) % 7;
}

export function startOfWeek(d) {
  return addDays(startOfDay(d), -isoDow(d));
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Ganze Kalendertage zwischen a und b. Math.round faengt die +/- 1 Stunde
 * ab, die bei einer DST-Umstellung im Intervall auftritt.
 */
export function diffDays(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

export function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

/** ISO-8601-Kalenderwoche. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dn + 3);           // Donnerstag dieser Woche
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fdn = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fdn + 3);
  return 1 + Math.round((t - firstThu) / (7 * 86400000));
}

/** 540 -> '09:00' */
export function minutesToHm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function fmtDateLong(d) {
  return `${WEEKDAY_LONG[isoDow(d)]}, ${d.getDate()}. ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateShort(d) {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function todayYmd() {
  return ymd(new Date());
}
