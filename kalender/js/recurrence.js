// recurrence.js — Expansion von Wiederholungsregeln.
//
// Implementiert ist eine TEILMENGE von RFC 5545:
//   FREQ = DAILY | WEEKLY | MONTHLY | YEARLY
//   INTERVAL, BYDAY (nur bei WEEKLY), COUNT, UNTIL, EXDATE
// Nicht implementiert: BYMONTHDAY, BYSETPOS, BYMONTH, WKST != MO,
// mehrere RRULEs, RDATE, positionale BYDAY-Angaben ("-1SU").
//
// COUNT zaehlt die von der Regel erzeugten Instanzen, EXDATE entfernt danach
// daraus — eine ausgenommene Instanz verbraucht also einen Zaehlschritt. Das
// entspricht RFC 5545 und ist nicht dasselbe wie "COUNT sichtbare Termine".

import {
  parseYmd, parseLocal, ymd, addDays, startOfWeek, isoDow,
  daysInMonth, diffDays,
} from './dates.js';

const HARD_CAP = 20000; // Schutz gegen Endlosschleifen bei kaputten Regeln

/**
 * Erzeugt die Starttermine (als Date, lokale Mitternacht) einer Serie,
 * aufsteigend, beginnend bei DTSTART, bis UNTIL/COUNT/limit erschoepft ist.
 */
export function* ruleDates(ev, limit) {
  const base = parseYmd(String(ev.start).slice(0, 10));
  const r = ev.rrule;

  if (!r || !r.freq || r.freq === 'NONE') {
    if (base <= limit) yield base;
    return;
  }

  const interval = Math.max(1, r.interval || 1);
  const until = r.until ? parseYmd(r.until) : null;
  const count = r.count || null;
  let emitted = 0;
  let guard = 0;

  const emit = (d) => {
    emitted += 1;
    return d;
  };
  const exhausted = () => count !== null && emitted >= count;

  if (r.freq === 'DAILY') {
    let d = base;
    while (guard++ < HARD_CAP) {
      if (until && d > until) return;
      if (d > limit) return;
      yield emit(d);
      if (exhausted()) return;
      d = addDays(d, interval);
    }
    return;
  }

  if (r.freq === 'WEEKLY') {
    const days = (r.byDay && r.byDay.length)
      ? [...new Set(r.byDay)].sort((a, b) => a - b)
      : [isoDow(base)];
    let weekStart = startOfWeek(base);
    while (guard++ < HARD_CAP) {
      for (const dow of days) {
        const d = addDays(weekStart, dow);
        if (d < base) continue;
        if (until && d > until) return;
        if (d > limit) return;
        yield emit(d);
        if (exhausted()) return;
      }
      weekStart = addDays(weekStart, 7 * interval);
      if (weekStart > limit) return;
    }
    return;
  }

  if (r.freq === 'MONTHLY') {
    const dom = base.getDate();
    let y = base.getFullYear();
    let m = base.getMonth();
    while (guard++ < HARD_CAP) {
      // Monate ohne diesen Monatstag (31. im Februar) werden uebersprungen
      // und verbrauchen KEINEN COUNT-Schritt — so schreibt es RFC 5545 vor.
      if (dom <= daysInMonth(y, m)) {
        const d = new Date(y, m, dom);
        if (d >= base) {
          if (until && d > until) return;
          if (d > limit) return;
          yield emit(d);
          if (exhausted()) return;
        }
      }
      m += interval;
      y += Math.floor(m / 12);
      m = ((m % 12) + 12) % 12;
      if (new Date(y, m, 1) > limit) return;
    }
    return;
  }

  if (r.freq === 'YEARLY') {
    const mon = base.getMonth();
    const dom = base.getDate();
    let y = base.getFullYear();
    while (guard++ < HARD_CAP) {
      if (dom <= daysInMonth(y, mon)) {   // 29.02. in Nicht-Schaltjahren
        const d = new Date(y, mon, dom);
        if (d >= base) {
          if (until && d > until) return;
          if (d > limit) return;
          yield emit(d);
          if (exhausted()) return;
        }
      }
      y += interval;
      if (new Date(y, 0, 1) > limit) return;
    }
  }
}

/**
 * Alle Instanzen von `ev`, die das Intervall [from, to] (Dates, lokale
 * Tagesgrenzen) beruehren.
 *
 * Rueckgabe je Instanz:
 *   { event, occDate:'YYYY-MM-DD', start:Date, end:Date, allDay, spanDays, key }
 * `end` ist bei ganztaegigen Terminen der EINSCHLIESSLICH letzte Tag.
 */
export function expand(ev, from, to) {
  const out = [];
  const exdates = new Set(ev.exdates || []);

  let durationMin = 0;
  let spanDays = 0;
  if (ev.allDay) {
    spanDays = Math.max(0, diffDays(parseYmd(ev.start), parseYmd(ev.end)));
  } else {
    durationMin = Math.max(0, (parseLocal(ev.end) - parseLocal(ev.start)) / 60000);
  }

  // Ein mehrtaegiger Termin kann vor `from` beginnen und trotzdem in den
  // Bereich hineinragen; ruleDates liefert ihn, weil sein Startdatum <= to
  // ist, und der End-Filter unten behaelt ihn.
  for (const d of ruleDates(ev, to)) {
    const key = ymd(d);
    if (exdates.has(key)) continue;

    let start; let end;
    if (ev.allDay) {
      start = d;
      end = addDays(d, spanDays);
    } else {
      const t = parseLocal(ev.start);
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.getHours(), t.getMinutes());
      end = new Date(start.getTime() + durationMin * 60000);
    }

    if (end < from) continue;
    if (start > to) continue;

    out.push({
      event: ev,
      occDate: key,
      start,
      end,
      allDay: !!ev.allDay,
      spanDays,
      key: `${ev.id}|${key}`,
    });
  }
  return out;
}

/** Instanzen aller Termine in [from, to], nach Startzeit sortiert. */
export function occurrencesInRange(events, from, to) {
  const all = [];
  for (const ev of events) all.push(...expand(ev, from, to));
  all.sort((a, b) => a.start - b.start
    || (b.end - b.start) - (a.end - a.start)
    || a.event.title.localeCompare(b.event.title, 'de'));
  return all;
}

/** Instanzen, die auf einen bestimmten Kalendertag fallen. */
export function occurrencesOnDay(occurrences, dayYmd) {
  return occurrences.filter((o) => {
    const s = ymd(o.start);
    const e = ymd(o.allDay ? o.end : new Date(o.end.getTime() - (o.end > o.start ? 1 : 0)));
    return s <= dayYmd && dayYmd <= e;
  });
}

/** Lesbare Beschreibung einer Regel, fuer die Terminliste. */
export function describeRule(r) {
  if (!r || !r.freq || r.freq === 'NONE') return '';
  const iv = r.interval > 1 ? `alle ${r.interval} ` : '';
  const names = { DAILY: 'Tage', WEEKLY: 'Wochen', MONTHLY: 'Monate', YEARLY: 'Jahre' };
  const single = { DAILY: 'täglich', WEEKLY: 'wöchentlich', MONTHLY: 'monatlich', YEARLY: 'jährlich' };
  let s = r.interval > 1 ? `${iv}${names[r.freq]}` : single[r.freq];
  if (r.freq === 'WEEKLY' && r.byDay && r.byDay.length) {
    const short = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    s += ` (${r.byDay.map((d) => short[d]).join(', ')})`;
  }
  if (r.count) s += `, ${r.count}×`;
  else if (r.until) s += `, bis ${r.until.split('-').reverse().join('.')}`;
  return s;
}
