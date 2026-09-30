// model.js — Datenmodell und Rechnungen der Finanzseite (rein, ohne DOM).
//
// Zustand:
//   { schema, accounts: [Konto], entries: [Eintrag], rates: [Kurs] }
//   Konto   { id, name, currency: 'EUR'|'CHF', kind, slot, archived, order }
//   Eintrag { id, seq, date, type, title, details, lines }
//     type 'buchung'    lines = [{ acc, amt }]            Einnahme > 0, Ausgabe < 0
//     type 'umbuchung'  lines = [{ acc, amt<0 }, { acc, amt>0 }]   von -> nach
//     type 'stand'      lines = [{ acc, bal }]            festgestellter Kontostand
//   Kurs    { date, chfPerEur }                            1 EUR = x CHF (Marktnotierung EUR/CHF)
//
// Alle Beträge sind ganze Cent bzw. Rappen (Number.isSafeInteger), damit
// Summen exakt bleiben. Umgerechnet wird erst beim Anzeigen.
//
// Reihenfolge: nach Datum, innerhalb eines Tages nach `seq` (Eingabereihenfolge,
// wie die Zeilen der Tabelle). Ein Eintrag 'stand' setzt den Saldo; die
// Differenz zum fortgeschriebenen Saldo ist seine „Abweichung“ (bei einem Depot
// die Kursentwicklung, bei einem Konto eine nicht erfasste Buchung).

export const SCHEMA = 1;
export const CURRENCIES = ['EUR', 'CHF'];
export const KINDS = [
  { id: 'giro', label: 'Girokonto' },
  { id: 'spar', label: 'Sparkonto' },
  { id: 'bar', label: 'Bargeld' },
  { id: 'depot', label: 'Depot' },
  { id: 'anlage', label: 'Anlage' },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));
export const TYPES = ['buchung', 'umbuchung', 'stand'];
export const SLOTS = 8;   // Farbplätze, fest je Konto (Farbe folgt dem Konto, nie dem Rang)

/* ------------------------------------------------------------------ */
/* Datum                                                               */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoDate(new Date());

export function dayNum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return NaN;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5);
}
export function fromDayNum(n) {
  const d = new Date(n * 864e5);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function validIso(iso) {
  const n = dayNum(iso);
  return Number.isFinite(n) && fromDayNum(n) === iso;
}

/** Eingabe -> ISO, '' für leer, null für unlesbar (wie in /projekte). */
export function parseDateInput(text, today = todayIso()) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return '';
  const t = dayNum(today);
  if (s === 'h' || s === 'heute') return today;
  if (s === 'g' || s === 'gestern') return fromDayNum(t - 1);
  let m = /^([+-])(\d{1,4})$/.exec(s);
  if (m) return fromDayNum(t + (m[1] === '+' ? 1 : -1) * Number(m[2]));
  const year = Number(today.slice(0, 4));
  let y; let mo; let d;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(s))) {
    d = +m[1]; mo = +m[2];
    y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
  } else if ((m = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(s))) {
    d = +m[1]; mo = +m[2]; y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else if ((m = /^(\d{2})(\d{2})$/.exec(s))) {
    d = +m[1]; mo = +m[2]; y = year;
  } else return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return validIso(iso) ? iso : null;
}

export function formatDate(iso, { year = true } = {}) {
  if (!validIso(iso)) return '';
  const [y, m, d] = iso.split('-');
  return year ? `${Number(d)}.${Number(m)}.${y}` : `${Number(d)}.${Number(m)}.`;
}

export const MONTHS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const monthOf = (iso) => iso.slice(0, 7);
export function formatMonth(ym, long = false) {
  const [y, m] = ym.split('-');
  return long ? `${MONTHS[Number(m) - 1]} ${y}` : `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}
export const lastDayOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return fromDayNum(Math.round(Date.UTC(y, m, 1) / 864e5) - 1);
};

/* ------------------------------------------------------------------ */
/* Beträge                                                             */
/* ------------------------------------------------------------------ */

/**
 * Eingabe -> Cent (ganzzahlig), null für leer, NaN für unlesbar.
 * Deutsch: Komma ist Dezimaltrenner, Punkt/Apostroph/Leerzeichen gruppieren
 * („1.234,50“, „1'234.50“ nur mit Punkt als Dezimal, wenn danach ≤ 2 Ziffern).
 * Summen und Differenzen sind erlaubt: „12,40 + 3,10 - 1“.
 */
export function parseAmount(text) {
  const s = String(text ?? '').replace(/[\s'’€]|CHF|EUR/gi, '');
  if (!s) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== s) return NaN;
  let total = 0;
  for (const raw of terms) {
    const sign = raw.startsWith('-') ? -1 : 1;
    let t = raw.replace(/^[+-]/, '');
    if (!/^[\d.,]+$/.test(t)) return NaN;
    const lastComma = t.lastIndexOf(',');
    const lastDot = t.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      const dec = lastComma > lastDot ? ',' : '.';
      const grp = dec === ',' ? '.' : ',';
      t = t.split(grp).join('');
      if (t.split(dec).length > 2) return NaN;
      t = t.replace(dec, '.');
    } else if (lastComma >= 0) {
      if (t.split(',').length > 2) return NaN;
      t = t.replace(',', '.');
    } else if (lastDot >= 0) {
      const parts = t.split('.');
      // „1.234“ und „1.234.567“ sind Tausender, „1.5“ und „12.34“ Dezimal.
      if (parts.length > 2 || parts[parts.length - 1].length === 3) {
        if (!parts.slice(1).every((p) => p.length === 3)) return NaN;
        t = parts.join('');
      }
    }
    if (!/^\d*\.?\d*$/.test(t) || t === '.' || t === '') return NaN;
    const [ip, fp = ''] = t.split('.');
    if (fp.length > 2) return NaN;
    const cents = Number(ip || '0') * 100 + Number((fp + '00').slice(0, 2));
    total += sign * cents;
  }
  return Number.isSafeInteger(total) ? total : NaN;
}

const nf = {};
function fmt(cur) {
  if (!nf[cur]) {
    nf[cur] = new Intl.NumberFormat('de-AT', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return nf[cur];
}
/** Cent -> „€ 1.234,56“ bzw. „CHF 1.234,56“. */
export function money(cents, cur = 'EUR', { sign = false } = {}) {
  if (cents == null || !Number.isFinite(cents)) return '–';
  const s = fmt(cur).format(cents / 100).replace(/ /g, ' ');
  return sign && cents > 0 ? `+${s}` : s;
}
/** Cent -> „1.234,56“ ohne Währung (für Eingabefelder). */
export function plain(cents) {
  if (cents == null || !Number.isFinite(cents)) return '';
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Kurs „1 EUR = x CHF“ als Zahl; akzeptiert Komma. */
export function parseRate(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) && v > 0 && v < 100 ? v : NaN;
}

/* ------------------------------------------------------------------ */
/* Anlegen und Normalisieren                                           */
/* ------------------------------------------------------------------ */

export function newId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export const emptyState = () => ({ schema: SCHEMA, accounts: [], entries: [], rates: [] });

const str = (v, max) => String(v ?? '').slice(0, max);
const cents = (v) => (Number.isSafeInteger(v) ? v : null);

export function normalizeAccount(a, i = 0) {
  return {
    id: str(a.id || newId(), 40),
    name: str(a.name, 80).trim() || 'Konto',
    currency: CURRENCIES.includes(a.currency) ? a.currency : 'EUR',
    kind: KIND_LABEL[a.kind] ? a.kind : 'giro',
    slot: Number.isInteger(a.slot) && a.slot >= 0 && a.slot < SLOTS ? a.slot : i % SLOTS,
    archived: !!a.archived,
    order: Number.isFinite(a.order) ? a.order : i,
  };
}

export function normalizeEntry(e, accIds) {
  const type = TYPES.includes(e.type) ? e.type : 'buchung';
  const lines = (Array.isArray(e.lines) ? e.lines : [])
    .filter((l) => l && accIds.has(l.acc))
    .map((l) => (type === 'stand' ? { acc: l.acc, bal: cents(l.bal) } : { acc: l.acc, amt: cents(l.amt) }))
    .filter((l) => (type === 'stand' ? l.bal !== null : l.amt !== null));
  return {
    id: str(e.id || newId(), 40),
    seq: Number.isFinite(e.seq) ? e.seq : 0,
    date: validIso(e.date) ? e.date : todayIso(),
    type,
    title: str(e.title, 120).trim(),
    details: str(e.details, 1000).trim(),
    lines,
  };
}

export function normalizeState(s) {
  const src = s && typeof s === 'object' ? s : {};
  const accounts = (Array.isArray(src.accounts) ? src.accounts : []).map(normalizeAccount);
  const seen = new Set();
  const uniqAcc = accounts.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  const accIds = new Set(uniqAcc.map((a) => a.id));
  const entries = (Array.isArray(src.entries) ? src.entries : [])
    .map((e) => normalizeEntry(e, accIds))
    .filter((e) => e.lines.length);
  const rates = (Array.isArray(src.rates) ? src.rates : [])
    .filter((r) => r && validIso(r.date) && Number.isFinite(r.chfPerEur) && r.chfPerEur > 0)
    .map((r) => ({ date: r.date, chfPerEur: r.chfPerEur }));
  const byDate = new Map(rates.map((r) => [r.date, r]));
  return {
    schema: SCHEMA,
    accounts: uniqAcc.sort((a, b) => a.order - b.order),
    entries,
    rates: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export const nextSeq = (s) => s.entries.reduce((m, e) => Math.max(m, e.seq), 0) + 1;

/** Freier Farbplatz für ein neues Konto (erster unbenutzter, sonst reihum). */
export function freeSlot(s) {
  const used = new Set(s.accounts.map((a) => a.slot));
  for (let i = 0; i < SLOTS; i += 1) if (!used.has(i)) return i;
  return s.accounts.length % SLOTS;
}

/* ------------------------------------------------------------------ */
/* Rechnen                                                             */
/* ------------------------------------------------------------------ */

export const sortEntries = (entries) => [...entries].sort(
  (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq),
);

/**
 * Wechselkurs zum Datum: letzter Kurs am oder vor dem Datum, sonst der
 * früheste bekannte. null, wenn es keinen gibt.
 */
export function rateAt(rates, date) {
  if (!rates.length) return null;
  let best = null;
  for (const r of rates) { if (r.date <= date) best = r; else break; }
  return (best || rates[0]).chfPerEur;
}

/** Cent in Kontowährung -> Cent EUR (gerundet). NaN, wenn für CHF kein Kurs da ist. */
export function toEur(amount, currency, chfPerEur) {
  if (currency === 'EUR') return amount;
  if (!chfPerEur) return NaN;
  return Math.round(amount / chfPerEur);
}

/**
 * Der ganze Verlauf in einem Durchgang.
 * @returns {{ rows: Array<{e, effects: Array<{acc, delta, after}>}>, balances: Map<string, number> }}
 *   rows in Buchungsreihenfolge; `delta` ist die Änderung des Kontos durch
 *   diesen Eintrag (bei 'stand' die Abweichung), `after` der Saldo danach,
 *   `opening` markiert den Anfangsbestand (erste Feststellung eines Kontos).
 */
export function ledger(state) {
  const bal = new Map(state.accounts.map((a) => [a.id, 0]));
  const touched = new Set();
  const rows = [];
  for (const e of sortEntries(state.entries)) {
    const effects = [];
    for (const l of e.lines) {
      if (!bal.has(l.acc)) continue;
      const before = bal.get(l.acc);
      const after = e.type === 'stand' ? l.bal : before + l.amt;
      bal.set(l.acc, after);
      // Erste Feststellung eines Kontos ohne vorherige Bewegung: Anfangsbestand,
      // keine Abweichung.
      const opening = e.type === 'stand' && !touched.has(l.acc);
      touched.add(l.acc);
      effects.push({ acc: l.acc, delta: after - before, after, opening });
    }
    rows.push({ e, effects });
  }
  return { rows, balances: bal };
}

/** Salden je Konto am Ende des Tages `date` (einschließlich). */
export function balancesAt(state, date, led = ledger(state)) {
  const bal = new Map(state.accounts.map((a) => [a.id, 0]));
  for (const r of led.rows) {
    if (r.e.date > date) break;
    for (const f of r.effects) bal.set(f.acc, f.after);
  }
  return bal;
}

/** Gesamtwert in EUR-Cent zu gegebenen Salden und Kurs; `missing` = CHF ohne Kurs. */
export function totalEur(state, balances, chfPerEur) {
  let sum = 0;
  let missing = false;
  for (const a of state.accounts) {
    const v = balances.get(a.id) || 0;
    const e = toEur(v, a.currency, chfPerEur);
    if (Number.isNaN(e)) { missing = missing || v !== 0; continue; }
    sum += e;
  }
  return { sum, missing };
}

/**
 * Zeitreihe für das Diagramm: ein Punkt je Tag mit Einträgen, Werte je Konto
 * in EUR-Cent zum Kurs dieses Tages.
 */
export function series(state, led = ledger(state)) {
  const bal = new Map(state.accounts.map((a) => [a.id, 0]));
  const pts = [];
  let i = 0;
  const rows = led.rows;
  while (i < rows.length) {
    const date = rows[i].e.date;
    while (i < rows.length && rows[i].e.date === date) {
      for (const f of rows[i].effects) bal.set(f.acc, f.after);
      i += 1;
    }
    const rate = rateAt(state.rates, date);
    const values = {};
    let total = 0;
    for (const a of state.accounts) {
      const v = toEur(bal.get(a.id) || 0, a.currency, rate);
      values[a.id] = Number.isNaN(v) ? 0 : v;
      total += values[a.id];
    }
    pts.push({ date, values, total });
  }
  return pts;
}

/**
 * Monatsrechnung in EUR. Je Monat:
 *   start/end   Gesamtvermögen am Monatsende davor / an diesem Monatsende
 *   income      Summe positiver Buchungen (nicht Umbuchungen)
 *   expense     Summe negativer Buchungen (positiv angegeben)
 *   opening     Anfangsbestände (erste Feststellung je Konto)
 *   valuation   Abweichungen aus späteren Feststellungen (Depotentwicklung u. ä.)
 *   fx          Rest: Wechselkurseffekte auf CHF-Bestände, Rundung, Umbuchungen
 *               zwischen Währungen — so, dass end = start + opening + income − expense + valuation + fx
 * Monate ohne Einträge zwischen erstem und letztem Monat sind enthalten.
 */
export function months(state, led = ledger(state), until = todayIso()) {
  if (!led.rows.length) return [];
  const accCur = new Map(state.accounts.map((a) => [a.id, a.currency]));
  const first = monthOf(led.rows[0].e.date);
  const lastEntry = monthOf(led.rows[led.rows.length - 1].e.date);
  const last = monthOf(until) > lastEntry ? monthOf(until) : lastEntry;
  const out = new Map();
  let [y, m] = first.split('-').map(Number);
  for (;;) {
    const ym = `${y}-${pad(m)}`;
    out.set(ym, { ym, opening: 0, income: 0, expense: 0, valuation: 0, fx: 0, start: 0, end: 0, missing: false });
    if (ym === last) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  for (const r of led.rows) {
    const mo = out.get(monthOf(r.e.date));
    const rate = rateAt(state.rates, r.e.date);
    for (const f of r.effects) {
      const v = toEur(f.delta, accCur.get(f.acc), rate);
      if (Number.isNaN(v)) { mo.missing = true; continue; }
      if (r.e.type === 'buchung') { if (v >= 0) mo.income += v; else mo.expense -= v; }
      else if (r.e.type === 'stand') { if (f.opening) mo.opening += v; else mo.valuation += v; }
    }
  }
  let prevEnd = 0;
  let idx = 0;
  const bal = new Map(state.accounts.map((a) => [a.id, 0]));
  for (const mo of out.values()) {
    const endDate = lastDayOfMonth(mo.ym);
    while (idx < led.rows.length && led.rows[idx].e.date <= endDate) {
      for (const f of led.rows[idx].effects) bal.set(f.acc, f.after);
      idx += 1;
    }
    const t = totalEur(state, bal, rateAt(state.rates, endDate));
    mo.start = prevEnd;
    mo.end = t.sum;
    mo.missing = mo.missing || t.missing;
    mo.fx = mo.end - mo.start - mo.opening - mo.income + mo.expense - mo.valuation;
    prevEnd = mo.end;
  }
  return [...out.values()];
}

/**
 * Auswertung nach Titel (Kategorie) für ein Jahr, nur Buchungen, in EUR.
 * @returns {{ rows: Array<{title, byMonth: number[12], sum}>, totals: number[12], sum }}
 *   getrennt für Einnahmen (sign 1) und Ausgaben (sign −1, positiv angegeben).
 */
export function byTitle(state, year, sign, led = ledger(state)) {
  const accCur = new Map(state.accounts.map((a) => [a.id, a.currency]));
  const map = new Map();
  const totals = Array(12).fill(0);
  for (const r of led.rows) {
    if (r.e.type !== 'buchung' || r.e.date.slice(0, 4) !== String(year)) continue;
    const rate = rateAt(state.rates, r.e.date);
    for (const f of r.effects) {
      const v = toEur(f.delta, accCur.get(f.acc), rate);
      if (Number.isNaN(v) || (sign > 0 ? v <= 0 : v >= 0)) continue;
      const key = r.e.title || '(ohne Titel)';
      const k = key.toLocaleLowerCase('de');
      if (!map.has(k)) map.set(k, { title: key, byMonth: Array(12).fill(0), sum: 0 });
      const row = map.get(k);
      const mi = Number(r.e.date.slice(5, 7)) - 1;
      const x = Math.abs(v);
      row.byMonth[mi] += x; row.sum += x; totals[mi] += x;
    }
  }
  const rows = [...map.values()].sort((a, b) => b.sum - a.sum);
  return { rows, totals, sum: totals.reduce((a, b) => a + b, 0) };
}

/** Häufigste Titel (für Vorschläge), zuletzt benutzte zuerst bei Gleichstand. */
export function titleSuggestions(state, limit = 60) {
  const m = new Map();
  for (const e of sortEntries(state.entries)) {
    if (!e.title) continue;
    const k = e.title.toLocaleLowerCase('de');
    const x = m.get(k) || { title: e.title, n: 0, last: '' };
    x.n += 1; x.last = e.date;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, limit).map((x) => x.title);
}

export const yearsOf = (state) => [...new Set(state.entries.map((e) => e.date.slice(0, 4)))].sort().reverse();
