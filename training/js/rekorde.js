// rekorde.js — eigene Bestleistungskategorien und Einträge. Reine Funktionen
// plus ein kleiner Store (localStorage `training.rekorde`), der dieselbe
// Schnittstelle wie der Projekte-Store hat, damit rekorde-sync.js ihn
// unverändert bedienen kann (state, subscribe, adoptExternal).
//
// Werte werden in der Einheit der Kategorie gespeichert; Zeiten in Sekunden.

export const STORAGE_KEY = 'training.rekorde';

export const KINDS = {
  time: { label: 'Zeit', better: 'lower', units: [''] },
  weight: { label: 'Gewicht', better: 'higher', units: ['kg'] },
  reps: { label: 'Wiederholungen', better: 'higher', units: ['Wdh.'] },
  distance: { label: 'Distanz', better: 'higher', units: ['km', 'm'] },
  number: { label: 'Zahl', better: 'higher', units: null },       // Einheit frei
};

export const SPORTS = ['ride', 'run', 'swim', 'strength', 'other'];

// Welche Arten je Sportart angelegt werden koennen
export const KINDS_BY_SPORT = {
  run: ['time', 'distance'],
  ride: ['time', 'distance', 'number'],
  swim: ['time', 'distance'],
  strength: ['weight', 'reps', 'time', 'number'],
  other: ['time', 'distance', 'weight', 'reps', 'number'],
};

export function emptyState() { return { v: 1, categories: [], excluded: [] }; }

const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

export function normalizeState(raw) {
  const out = emptyState();
  const cats = Array.isArray(raw?.categories) ? raw.categories : [];
  for (const c of cats) {
    if (!c || typeof c !== 'object') continue;
    const kind = KINDS[c.kind] ? c.kind : 'number';
    const cat = {
      id: str(c.id, 80) || uid(),
      name: str(c.name, 80).trim() || 'Ohne Namen',
      sport: SPORTS.includes(c.sport) ? c.sport : 'other',
      kind,
      unit: str(c.unit, 20),
      better: c.better === 'lower' ? 'lower' : c.better === 'higher' ? 'higher' : KINDS[kind].better,
      created: str(c.created, 40) || new Date().toISOString(),
      entries: [],
    };
    for (const e of Array.isArray(c.entries) ? c.entries : []) {
      const value = Number(e?.value);
      if (!Number.isFinite(value) || !isDay(e?.date)) continue;
      cat.entries.push({ id: str(e.id, 80) || uid(), date: e.date, value, note: str(e.note, 200) });
    }
    cat.entries.sort((a, b) => a.date.localeCompare(b.date));
    out.categories.push(cat);
  }
  // Verworfene automatische Bestwerte (GPS-Fehler): {aid, metric, at}
  // metric: 'best:<m>' | 'mm_pw:<s>' | 'mm_v:<s>' | '*' (ganze Aktivitaet)
  const seen = new Set();
  for (const x of Array.isArray(raw?.excluded) ? raw.excluded : []) {
    const aid = str(x?.aid, 40), metric = str(x?.metric, 40);
    if (!aid || !/^(\*|best:\d+|mm_pw:\d+|mm_v:\d+)$/.test(metric)) continue;
    const k = `${aid}|${metric}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.excluded.push({ aid, metric, at: str(x.at, 40) || new Date().toISOString() });
  }
  return out;
}

// ------------------------------------------------------------------ Verworfene Bestwerte

/** Test-Funktion (aid, metric) -> bool, schnell fuer viele Abfragen. */
export function exclusionTest(s) {
  const set = new Set((s.excluded || []).map(x => `${x.aid}|${x.metric}`));
  return (aid, metric) => set.has(`${aid}|*`) || set.has(`${aid}|${metric}`);
}

export function exclude(s, aid, metric) {
  s.excluded = s.excluded || [];
  if (metric === '*') s.excluded = s.excluded.filter(x => x.aid !== aid);   // umfasst alles
  else if (s.excluded.some(x => x.aid === aid && (x.metric === metric || x.metric === '*'))) return;
  s.excluded.push({ aid, metric, at: new Date().toISOString() });
}

export function restore(s, aid, metric) {
  s.excluded = (s.excluded || []).filter(x => !(x.aid === aid && x.metric === metric));
}

// ------------------------------------------------------------------ Werte

function num(text) {
  const t = String(text).trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Eingabetext -> Zahl in der Einheit der Kategorie, oder null. */
export function parseValue(cat, text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (cat.kind === 'time') {
    const parts = t.replace(',', '.').split(':');
    if (parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
    const n = parts.map(Number);
    if (parts.slice(1).some(p => Number(p) >= 60)) return null;
    const sec = n.reduce((acc, x) => acc * 60 + x, 0);
    return sec > 0 ? sec : null;
  }
  if (cat.kind === 'distance') {
    const m = /^([\d.,\s]+)\s*(km|m)?$/i.exec(t);
    if (!m) return null;
    let v = num(m[1]);
    if (v == null || v <= 0) return null;
    const given = (m[2] || '').toLowerCase();
    if (given && given !== cat.unit) v = given === 'km' ? v * 1000 : v / 1000;
    return v;
  }
  const v = num(t.replace(/\s*(kg|wdh\.?)$/i, ''));
  if (v == null) return null;
  if ((cat.kind === 'weight' || cat.kind === 'reps') && v < 0) return null;
  return v;
}

const nf = new Map();
function fmtNum(v, max = 2) {
  if (!nf.has(max)) nf.set(max, new Intl.NumberFormat('de-AT', { maximumFractionDigits: max }));
  return nf.get(max).format(v);
}

export function formatValue(cat, v) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (cat.kind === 'time') {
    const whole = Math.floor(v + 1e-9);
    const frac = v - whole;
    const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
    const ss = String(s).padStart(2, '0') + (frac >= 0.05 ? `,${Math.round(frac * 10) % 10}` : '');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }
  const unit = cat.kind === 'number' ? cat.unit : (cat.unit || KINDS[cat.kind].units[0]);
  return unit ? `${fmtNum(v)} ${unit}` : fmtNum(v);
}

export function inputHint(cat) {
  if (cat.kind === 'time') return 'z. B. 17:45 oder 1:23:45';
  if (cat.kind === 'distance') return `z. B. 12,5 (${cat.unit})`;
  if (cat.kind === 'weight') return 'z. B. 102,5';
  if (cat.kind === 'reps') return 'z. B. 12';
  return cat.unit ? `Wert in ${cat.unit}` : 'Wert';
}

/** Bester Eintrag (bei Gleichstand der frühere), oder null. */
export function bestEntry(cat) {
  let best = null;
  for (const e of cat.entries) {
    if (!best) { best = e; continue; }
    const better = cat.better === 'lower' ? e.value < best.value : e.value > best.value;
    if (better) best = e;
  }
  return best;
}

export function lastEntry(cat) {
  return cat.entries.length ? cat.entries[cat.entries.length - 1] : null;
}

// ------------------------------------------------------------------ Änderungen (auf einem state-Objekt)

export function addCategory(s, { name, sport, kind, unit, better }) {
  const k = KINDS[kind] ? kind : 'number';
  const cat = normalizeState({ categories: [{
    id: uid(), name, sport, kind: k,
    unit: k === 'number' ? unit : (KINDS[k].units.includes(unit) ? unit : KINDS[k].units[0]),
    better: better || KINDS[k].better, entries: [],
  }] }).categories[0];
  s.categories.push(cat);
  return cat;
}

export function findCategory(s, id) { return s.categories.find(c => c.id === id) || null; }

export function addEntry(s, catId, { date, value, note }) {
  const c = findCategory(s, catId);
  if (!c || !isDay(date) || !Number.isFinite(value)) return null;
  const e = { id: uid(), date, value, note: str(note, 200) };
  c.entries.push(e);
  c.entries.sort((a, b) => a.date.localeCompare(b.date));
  return e;
}

export function removeEntry(s, catId, entryId) {
  const c = findCategory(s, catId);
  if (c) c.entries = c.entries.filter(e => e.id !== entryId);
}

export function clearCategory(s, catId) {
  const c = findCategory(s, catId);
  if (c) c.entries = [];
}

export function removeCategory(s, catId) {
  s.categories = s.categories.filter(c => c.id !== catId);
}

export function renameCategory(s, catId, name) {
  const c = findCategory(s, catId);
  const n = str(name, 80).trim();
  if (c && n) c.name = n;
}

// ------------------------------------------------------------------ Store

export class RekordeStore {
  constructor() {
    this.state = emptyState();
    this.listeners = new Set();
    this.lastRaw = null;
    this.storageOk = true;
  }

  load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { this.storageOk = false; }
    this.lastRaw = raw;
    if (raw) { try { this.state = normalizeState(JSON.parse(raw)); } catch { this.state = emptyState(); } }
    return this.state;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _notify(meta) { for (const fn of this.listeners) fn(this.state, meta); }

  commit(mutate, label = '') {
    mutate(this.state);
    this._write();
    this._notify({ label });
  }

  /** Fremden Stand übernehmen (Server, anderes Fenster). */
  adoptExternal(next, { write = true } = {}) {
    this.state = normalizeState(next);
    if (write) this._write();
    this._notify({ label: 'extern', external: true });
  }

  _write() {
    const raw = JSON.stringify(this.state);
    try { localStorage.setItem(STORAGE_KEY, raw); this.lastRaw = raw; this.storageOk = true; }
    catch { this.storageOk = false; }
  }

  watchOtherWindows() {
    const check = raw => {
      if (raw == null || raw === this.lastRaw) return;
      this.lastRaw = raw;
      try { this.adoptExternal(JSON.parse(raw), { write: false }); } catch { /* ignorieren */ }
    };
    window.addEventListener('storage', e => { if (e.key === STORAGE_KEY) check(e.newValue); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { try { check(localStorage.getItem(STORAGE_KEY)); } catch { /* egal */ } }
    });
  }
}
