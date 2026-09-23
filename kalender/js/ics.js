// ics.js — Export/Import einer RFC-5545-Teilmenge (iCalendar).
//
// Zeitzonen-Entscheidung: Termine mit Uhrzeit werden als "floating local time"
// geschrieben (weder TZID noch Z). RFC 5545 definiert das als "Ortszeit des
// lesenden Kalenders". Damit braucht die Datei keine VTIMEZONE-Komponente und
// keine Annahme ueber die Zeitzone dieses Geraets. Preis: importiert man die
// Datei in einen Kalender mit anderer Zeitzone, bleiben die Termine auf ihrer
// Wanduhrzeit — genau dasselbe Verhalten wie in der App selbst.
// RFC 5545 §3.3.10 verlangt, dass UNTIL denselben Werttyp hat wie DTSTART;
// deshalb wird auch UNTIL floating geschrieben.

import { pad, parseLocal, parseYmd, ymd, addDays, diffDays } from './dates.js';
import { uid, normalizeEvent } from './store.js';

const PRODID = '-//leopoldkarl.com//Kalender//DE';
const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Faltung nach RFC 5545 §3.1: max. 75 Oktette pro Zeile. */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {                       // ueber Codepoints, nicht Code Units
    const n = new TextEncoder().encode(ch).length;
    const budget = out.length === 0 ? 75 : 74;   // Folgezeilen beginnen mit einem Space
    if (curBytes + n > budget) {
      out.push(cur);
      cur = ch;
      curBytes = n;
    } else {
      cur += ch;
      curBytes += n;
    }
  }
  if (cur) out.push(cur);
  return out[0] + out.slice(1).map((s) => '\r\n ' + s).join('');
}

const dateVal = (s) => String(s).slice(0, 10).replace(/-/g, '');
const dtVal = (s) => `${dateVal(s)}T${String(s).slice(11, 16).replace(':', '')}00`;

function utcStamp(d = new Date()) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
       + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function rruleString(r) {
  if (!r || !r.freq || r.freq === 'NONE') return null;
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'WEEKLY' && r.byDay && r.byDay.length) {
    parts.push(`BYDAY=${r.byDay.map((d) => DOW[d]).join(',')}`);
  }
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${dateVal(r.until)}T235959`);
  return parts.join(';');
}

export function toICS(state) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const stamp = utcStamp();

  for (const ev of state.events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@leopoldkarl.com`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateVal(ev.start)}`);
      // DTEND ist bei VALUE=DATE exklusiv, also ein Tag nach dem letzten Tag.
      lines.push(`DTEND;VALUE=DATE:${dateVal(ymd(addDays(parseYmd(ev.end), 1)))}`);
    } else {
      lines.push(`DTSTART:${dtVal(ev.start)}`);
      lines.push(`DTEND:${dtVal(ev.end)}`);
    }
    lines.push(`SUMMARY:${esc(ev.title)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${esc(ev.notes)}`);
    if (ev.category) lines.push(`CATEGORIES:${esc(ev.category)}`);
    // Eigene Erweiterung: erlaubt, das Alter beim Wiedereinlesen weiter pro
    // Instanz zu berechnen. Fremde Kalender ignorieren X-Properties.
    if (ev.birthYear) lines.push(`X-BIRTH-YEAR:${ev.birthYear}`);
    const rr = rruleString(ev.rrule);
    if (rr) lines.push(`RRULE:${rr}`);
    if (ev.exdates && ev.exdates.length) {
      if (ev.allDay) {
        lines.push(`EXDATE;VALUE=DATE:${ev.exdates.map(dateVal).join(',')}`);
      } else {
        const t = String(ev.start).slice(11, 16).replace(':', '');
        lines.push(`EXDATE:${ev.exdates.map((d) => `${dateVal(d)}T${t}00`).join(',')}`);
      }
    }
    lines.push('END:VEVENT');
  }

  for (const t of state.tasks) {
    lines.push('BEGIN:VTODO');
    lines.push(`UID:${t.id}@leopoldkarl.com`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DUE;VALUE=DATE:${dateVal(t.date)}`);
    lines.push(`SUMMARY:${esc(t.title)}`);
    lines.push(`STATUS:${t.done ? 'COMPLETED' : 'NEEDS-ACTION'}`);
    if (t.done) lines.push('PERCENT-COMPLETE:100');
    lines.push('END:VTODO');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function unescape_(s) {
  return String(s)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Faltung rueckgaengig machen und in {name, params, value} zerlegen. */
function parseLines(text) {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const joined = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && joined.length) joined[joined.length - 1] += line.slice(1);
    else joined.push(line);
  }
  return joined
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const i = l.indexOf(':');
      if (i < 0) return null;
      const left = l.slice(0, i);
      const value = l.slice(i + 1);
      const [name, ...paramParts] = left.split(';');
      const params = {};
      for (const p of paramParts) {
        const j = p.indexOf('=');
        if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '');
      }
      return { name: name.toUpperCase(), params, value };
    })
    .filter(Boolean);
}

/**
 * iCalendar-Zeitwert -> lokaler String.
 * 'YYYYMMDD'            -> 'YYYY-MM-DD'
 * 'YYYYMMDDTHHMMSS'     -> 'YYYY-MM-DDTHH:MM'  (floating, unveraendert)
 * 'YYYYMMDDTHHMMSSZ'    -> in Ortszeit dieses Geraets umgerechnet
 * TZID=...              -> als floating behandelt (siehe Hinweis im Import-Dialog)
 */
function parseIcsValue(value, params) {
  const v = String(value).trim();
  if (/^\d{8}$/.test(v) || params.VALUE === 'DATE') {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === 'Z') {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
         + `T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function parseRRule(value) {
  const parts = {};
  for (const kv of String(value).split(';')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1);
  }
  const freq = (parts.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(',')
        .map((d) => DOW.indexOf(d.replace(/^[+-]?\d+/, '').toUpperCase()))
        .filter((i) => i >= 0)
    : null;
  let until = null;
  if (parts.UNTIL) {
    const u = parseIcsValue(parts.UNTIL, {});
    if (u) until = u.slice(0, 10);
  }
  return {
    freq,
    interval: Math.max(1, parseInt(parts.INTERVAL, 10) || 1),
    byDay: byDay && byDay.length ? byDay : null,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : null,
    until,
  };
}

/**
 * Liest VEVENT und VTODO. Rueckgabe { events, tasks, skipped }.
 * `skipped` zaehlt Komponenten, die nicht interpretierbar waren — die Zahl
 * wird angezeigt, statt sie stillschweigend zu verschlucken.
 */
export function parseICS(text, categories = []) {
  const known = new Set(categories.map((c) => c.id));
  const lines = parseLines(text);
  const events = [];
  const meta = [];        // uid / recurrenceId je Termin, fuer die Nachbereitung
  const tasks = [];
  let skipped = 0;
  let cancelled = 0;
  let cur = null;
  let kind = null;

  for (const { name, params, value } of lines) {
    if (name === 'BEGIN' && (value === 'VEVENT' || value === 'VTODO')) {
      cur = { exdates: [] };
      kind = value;
      continue;
    }
    if (name === 'END' && (value === 'VEVENT' || value === 'VTODO')) {
      if (!cur) continue;
      try {
        if (kind === 'VEVENT') {
          if (cur.status === 'CANCELLED') { cancelled += 1; cur = null; kind = null; continue; }
          const ev = finishEvent(cur, known);
          if (ev) { events.push(ev); meta.push({ uid: cur.uid, recurrenceId: cur.recurrenceId }); }
          else skipped += 1;
        } else {
          const t = finishTodo(cur);
          if (t) tasks.push(t); else skipped += 1;
        }
      } catch (err) {
        console.warn('[kalender] ics-Komponente übersprungen:', err);
        skipped += 1;
      }
      cur = null; kind = null;
      continue;
    }
    if (!cur) continue;

    switch (name) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.summary = unescape_(value); break;
      case 'DESCRIPTION': cur.description = unescape_(value); break;
      case 'CATEGORIES': cur.categories = unescape_(value); break;
      case 'STATUS': cur.status = value.toUpperCase(); break;
      case 'X-BIRTH-YEAR': cur.birthYear = parseInt(value, 10) || null; break;
      case 'DTSTART':
        cur.start = parseIcsValue(value, params);
        cur.startIsDate = params.VALUE === 'DATE' || /^\d{8}$/.test(value.trim());
        break;
      case 'DTEND':
        cur.end = parseIcsValue(value, params);
        cur.endIsDate = params.VALUE === 'DATE' || /^\d{8}$/.test(value.trim());
        break;
      case 'DUE': cur.due = parseIcsValue(value, params); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseIcsValue(value, params); break;
      case 'DURATION': cur.duration = value; break;
      case 'RRULE': cur.rrule = parseRRule(value); break;
      case 'EXDATE':
        for (const part of value.split(',')) {
          const p = parseIcsValue(part, params);
          if (p) cur.exdates.push(p.slice(0, 10));
        }
        break;
      default: break;
    }
  }

  return { ...reconcileOverrides(events, meta), tasks, skipped, cancelled };
}

/**
 * Google und andere Kalender exportieren eine geaenderte Einzelinstanz einer
 * Serie als zweites VEVENT mit derselben UID plus RECURRENCE-ID. Ohne
 * Nachbereitung stuenden danach beide im Kalender: die urspruengliche
 * Instanz aus der Serie UND die Abweichung.
 *
 * Behandlung: die Abweichung bekommt eine eigene ID und wird ein
 * eigenstaendiger Termin, die Serie bekommt fuer dieses Datum ein EXDATE.
 * Das ist dasselbe Verfahren, das die App beim Loesen einer Instanz
 * anwendet, und haelt die Datenstruktur frei von Override-Sonderfaellen.
 */
function reconcileOverrides(events, meta) {
  const byUid = new Map();
  events.forEach((ev, i) => {
    const m = meta[i];
    if (m && m.uid && !m.recurrenceId) byUid.set(m.uid, ev);
  });

  const seen = new Set();
  const out = [];
  let overrides = 0;

  events.forEach((ev, i) => {
    const m = meta[i] || {};
    if (m.recurrenceId) {
      const day = String(m.recurrenceId).slice(0, 10);
      const master = byUid.get(m.uid);
      if (master) {
        master.exdates = Array.from(new Set([...(master.exdates || []), day])).sort();
        overrides += 1;
      }
      ev.id = `${ev.id}-${day.replace(/-/g, '')}`;
      ev.rrule = null;
    }
    // Gleiche ID zweimal in derselben Datei: die spaetere gewinnt nicht
    // stillschweigend, sie bekommt eine eigene ID.
    let id = ev.id;
    let n = 2;
    while (seen.has(id)) { id = `${ev.id}-${n}`; n += 1; }
    ev.id = id;
    seen.add(id);
    out.push(ev);
  });

  return { events: out, overrides };
}

function parseDuration(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s).trim());
  if (!m) return null;
  return (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

function finishEvent(c, known) {
  if (!c.start) return null;
  const allDay = !!c.startIsDate;
  let start = c.start;
  let end = c.end;

  if (!end && c.duration) {
    const mins = parseDuration(c.duration);
    if (mins !== null) {
      if (allDay) end = ymd(addDays(parseYmd(start), Math.max(0, Math.round(mins / 1440) - 1)));
      else end = isoMinute(new Date(parseLocal(start).getTime() + mins * 60000));
    }
  }
  if (!end) {
    end = allDay ? start : isoMinute(new Date(parseLocal(start).getTime() + 3600000));
  }
  if (allDay) {
    // DTEND ist exklusiv -> letzter Tag ist DTEND minus ein Tag.
    const last = addDays(parseYmd(end), -1);
    end = ymd(last < parseYmd(start) ? parseYmd(start) : last);
  }

  const cat = (c.categories || '').split(',')[0]?.trim().toLowerCase();
  // Ein jaehrlicher Termin mit Jahrgang ist ein Geburtstag; dann soll der
  // 29.02. auch nach dem Wiedereinlesen auf den 28. klemmen.
  const rrule = c.rrule && c.birthYear && c.rrule.freq === 'YEARLY'
    ? { ...c.rrule, leapFallback: true }
    : c.rrule;
  return normalizeEvent({
    id: c.uid ? c.uid.replace(/@.*$/, '') : uid(),
    title: c.summary || '(ohne Titel)',
    notes: c.description || '',
    allDay,
    start,
    end,
    category: known.has(cat) ? cat : 'sonstiges',
    rrule,
    exdates: c.exdates,
    birthYear: c.birthYear ?? null,
  });
}

function finishTodo(c) {
  const date = (c.due || c.start || '').slice(0, 10);
  if (!date) return null;
  return {
    id: c.uid ? c.uid.replace(/@.*$/, '') : uid(),
    date,
    title: c.summary || '(ohne Titel)',
    done: c.status === 'COMPLETED',
    order: Date.now(),
  };
}

function isoMinute(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export { diffDays };
