// contacts.js — Geburtsdaten aus Kontakt-Exporten lesen.
//
// Unterstuetzt Google CSV (und CSV-Exporte anderer Anbieter, soweit sie eine
// erkennbare Geburtstags-Spalte haben) sowie vCard 3.0/4.0 (.vcf).
//
// Grundsatz: nichts raten. Ein Datum, das mehrdeutig ist (03/04/2001 kann der
// 3. April oder der 4. März sein), wird als `ambiguous` markiert und in der
// Vorschau ausgewiesen, statt stillschweigend in eine Richtung aufgelöst zu
// werden.

/* ------------------------------------------------------------------ */
/* Kodierung                                                           */
/* ------------------------------------------------------------------ */

/**
 * Dekodiert einen Datei-Puffer. Manche Kontakt-Exporte kommen als UTF-16;
 * mit UTF-8 gelesen ergaeben sie Buchstabensalat, deshalb wird die BOM
 * ausgewertet und, wenn keine da ist, auf Null-Bytes geprueft.
 */
export function decodeBuffer(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(b.subarray(2));
  }
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(b.subarray(2));
  }
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(b.subarray(3));
  }
  // Ohne BOM: viele Null-Bytes an geraden/ungeraden Positionen deuten auf UTF-16.
  const probe = b.subarray(0, Math.min(b.length, 512));
  let zerosOdd = 0;
  let zerosEven = 0;
  for (let i = 0; i < probe.length; i += 1) {
    if (probe[i] === 0) { if (i % 2) zerosOdd += 1; else zerosEven += 1; }
  }
  if (zerosOdd > probe.length / 4) return new TextDecoder('utf-16le').decode(b);
  if (zerosEven > probe.length / 4) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** CSV nach RFC 4180: Anfuehrungszeichen, verdoppelte Quotes, Zeilenumbrueche im Feld. */
export function parseCsv(text, delimiter = ',') {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === delimiter) { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Rät das Trennzeichen aus der Kopfzeile (Google: Komma, deutsche Excel-Exporte: Semikolon). */
function sniffDelimiter(text) {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const c of firstLine) {
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && c in counts) counts[c] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

const norm = (s) => String(s).toLowerCase().replace(/[\s_-]/g, '');

const plural = (n) => (n === 1
  ? '1 Kontakt ohne Geburtsdatum übersprungen.'
  : `${n} Kontakte ohne Geburtsdatum übersprungen.`);

function findColumn(header, patterns) {
  for (let i = 0; i < header.length; i += 1) {
    const h = norm(header[i]);
    for (const p of patterns) if (p.test(h)) return i;
  }
  return -1;
}

/**
 * Baut aus den Namensspalten einen Anzeigenamen. Google CSV hat je nach
 * Exportgeneration "Name" oder "First Name"/"Last Name"; beides wird bedient.
 */
function nameFromRow(row, cols) {
  const get = (i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const full = get(cols.name);
  if (full) return full;
  const parts = [get(cols.first), get(cols.middle), get(cols.last)].filter(Boolean);
  if (parts.length) return parts.join(' ');
  const org = get(cols.org);
  if (org) return org;
  return '';
}

export function parseContactsCsv(text) {
  const delimiter = sniffDelimiter(text);
  const rows = parseCsv(text, delimiter).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!rows.length) return { entries: [], diagnostics: ['Datei ist leer.'] };

  const header = rows[0];
  const cols = {
    birthday: findColumn(header, [/^birthday$/, /birthday/, /geburtstag/, /geburtsdatum/, /^bday$/]),
    name: findColumn(header, [/^name$/, /^displayname$/, /^fullname$/, /^anzeigename$/]),
    first: findColumn(header, [/^firstname$/, /^givenname$/, /^vorname$/]),
    middle: findColumn(header, [/^middlename$/, /^additionalname$/]),
    last: findColumn(header, [/^lastname$/, /^familyname$/, /^nachname$/]),
    org: findColumn(header, [/^organizationname$/, /^organization$/, /^company$/, /^firma$/]),
  };

  const diagnostics = [];
  if (cols.birthday < 0) {
    return {
      entries: [],
      diagnostics: [`Keine Geburtstags-Spalte gefunden. Vorhandene Spalten: ${header.filter(Boolean).join(', ')}`],
    };
  }

  const entries = [];
  let withoutBirthday = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const raw = String(rows[r][cols.birthday] ?? '').trim();
    if (!raw) { withoutBirthday += 1; continue; }
    const name = nameFromRow(rows[r], cols) || '(ohne Namen)';
    const parsed = parseBirthday(raw);
    entries.push({ name, raw, ...(parsed || { ok: false }) });
  }
  if (withoutBirthday) diagnostics.push(plural(withoutBirthday));
  return { entries, diagnostics, columns: header };
}

/* ------------------------------------------------------------------ */
/* vCard                                                               */
/* ------------------------------------------------------------------ */

export function parseVCard(text) {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }

  const entries = [];
  const diagnostics = [];
  let cur = null;
  let withoutBirthday = 0;

  const unesc = (s) => String(s).replace(/\\n/gi, '\n').replace(/\\,/g, ',')
    .replace(/\\;/g, ';').replace(/\\\\/g, '\\');

  for (const line of lines) {
    const t = line.trim();
    if (/^BEGIN:VCARD$/i.test(t)) { cur = { omitYear: false }; continue; }
    if (/^END:VCARD$/i.test(t)) {
      if (cur) {
        const name = cur.fn || cur.n || '(ohne Namen)';
        if (cur.bday) {
          const parsed = parseBirthday(cur.bday, { omitYear: cur.omitYear });
          entries.push({ name, raw: cur.bday, ...(parsed || { ok: false }) });
        } else withoutBirthday += 1;
      }
      cur = null; continue;
    }
    if (!cur) continue;

    const idx = t.indexOf(':');
    if (idx < 0) continue;
    const left = t.slice(0, idx);
    const value = t.slice(idx + 1);
    const [prop, ...params] = left.split(';');
    const name = prop.toUpperCase();

    if (name === 'FN') cur.fn = unesc(value).trim();
    else if (name === 'N') {
      const p = value.split(';').map((x) => unesc(x).trim());
      cur.n = [p[1], p[0]].filter(Boolean).join(' ');   // Vorname Nachname
    } else if (name === 'BDAY') {
      cur.bday = value.trim();
      // Apple markiert "Jahr unbekannt" durch X-APPLE-OMIT-YEAR=1604.
      if (params.some((p) => /X-APPLE-OMIT-YEAR/i.test(p))) cur.omitYear = true;
    } else if (name === 'ORG' && !cur.fn && !cur.n) {
      cur.fn = unesc(value.split(';')[0]).trim();
    }
  }

  if (withoutBirthday) diagnostics.push(plural(withoutBirthday));
  return { entries, diagnostics };
}

/* ------------------------------------------------------------------ */
/* Datumserkennung                                                     */
/* ------------------------------------------------------------------ */

/**
 * Erkennt die üblichen Schreibweisen eines Geburtsdatums.
 * Rückgabe { ok, y|null, m, d, ambiguous? } oder null, wenn nichts passt.
 *
 * Bewusst NICHT geraten wird bei Formen wie 03/04/2001, in denen weder Tag
 * noch Monat über 12 liegt: die werden als `ambiguous` durchgereicht.
 */
export function parseBirthday(input, { omitYear = false } = {}) {
  const s = String(input).trim();
  if (!s) return null;
  let m;

  const ok = (y, mo, d, extra = {}) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return { ok: false, raw: s };
    if (d > daysInMonthOf(y ?? 2000, mo)) return { ok: false, raw: s };
    return { ok: true, y: omitYear ? null : y, m: mo, d, ...extra };
  };

  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return ok(yearOrNull(+m[1]), +m[2], +m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return ok(yearOrNull(+m[1]), +m[2], +m[3]);
  if ((m = /^--(\d{2})-?(\d{2})$/.exec(s))) return ok(null, +m[1], +m[2]);
  if ((m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s))) return ok(yearOrNull(+m[1]), +m[2], +m[3]);

  // Punkt-Notation ist im deutschen Raum eindeutig Tag.Monat.Jahr.
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return ok(yearOrNull(+m[3]), +m[2], +m[1]);
  if ((m = /^(\d{1,2})\.(\d{1,2})\.$/.exec(s))) return ok(null, +m[2], +m[1]);

  // Schrägstrich: nur auflösen, wenn eine Komponente > 12 ist.
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    const a = +m[1]; const b = +m[2]; const y = yearOrNull(+m[3]);
    if (a > 12 && b <= 12) return ok(y, b, a);
    if (b > 12 && a <= 12) return ok(y, a, b);
    return { ok: false, ambiguous: true, raw: s, guess: { y, m: a, d: b } };
  }

  return { ok: false, raw: s };
}

function yearOrNull(y) {
  // 1604 ist Apples Platzhalter fuer "Jahr unbekannt".
  if (y === 1604) return null;
  return y;
}

function daysInMonthOf(y, m) {
  return new Date(y, m, 0).getDate();
}

/* ------------------------------------------------------------------ */
/* Nach Terminen                                                       */
/* ------------------------------------------------------------------ */

/** Stabile, kurze ID aus Name und Datum, damit ein zweiter Import nicht verdoppelt. */
export function birthdayId(name, mo, d) {
  let h = 2166136261;
  const s = `${name}|${mo}|${d}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `bday-${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}-${(h >>> 0).toString(36)}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Wandelt eine erkannte Zeile in einen jährlichen ganztägigen Termin. */
export function toBirthdayEvent(entry, { categoryId = 'geburtstag', fallbackYear } = {}) {
  const year = entry.y ?? (fallbackYear ?? new Date().getFullYear());
  const date = `${year}-${pad2(entry.m)}-${pad2(entry.d)}`;
  return {
    id: birthdayId(entry.name, entry.m, entry.d),
    title: entry.name,
    allDay: true,
    start: date,
    end: date,
    category: categoryId,
    notes: 'Aus Kontakten importiert',
    birthYear: entry.y ?? null,
    rrule: {
      freq: 'YEARLY', interval: 1, byDay: null, count: null, until: null,
      // 29. Februar: in Nicht-Schaltjahren auf den 28. klemmen statt auslassen.
      leapFallback: true,
    },
    exdates: [],
  };
}

/** Einstiegspunkt: Dateiinhalt -> { entries, diagnostics, kind } */
export function parseContactsFile(text, filename = '') {
  const looksVcf = /BEGIN:VCARD/i.test(text) || /\.vcf$/i.test(filename);
  const result = looksVcf ? parseVCard(text) : parseContactsCsv(text);
  return { ...result, kind: looksVcf ? 'vcard' : 'csv' };
}
