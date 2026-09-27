// worker/src/index.js — Datenschnittstelle des Kalenders.
//
// Der Worker verwahrt genau einen undurchsichtigen Block. Er kann ihn nicht
// lesen: verschluesselt wird im Browser (js/crypto.js). Dieser Code sieht
// Base64 und eine Versionsnummer, sonst nichts — deshalb steht hier auch
// keinerlei Kalenderlogik, und deshalb kann eine Aenderung am Datenmodell
// ohne Server-Anpassung passieren.
//
// Schnittstelle:
//   GET  /state -> 200 { version, updatedAt, blob }   (version 0, blob null: noch nichts da)
//   PUT  /state    { baseVersion, blob }
//                -> 200 { version, updatedAt }
//                -> 409 { version, updatedAt, blob }  (inzwischen hat ein anderes Geraet geschrieben)
//   GET  /health -> 200 { ok: true }
//
// Die Versionsnummer ist die ganze Konfliktbehandlung: wer schreibt, sagt,
// auf welchem Stand er aufsetzt. Stimmt der nicht mehr, bekommt er den
// aktuellen zurueck statt ihn zu ueberschreiben. Zusammenfuehren kann der
// Server nicht — er sieht ja nur Chiffrat —, das entscheidet der Client.

const ROW_ID = 'default';
const MAX_BLOB_BYTES = 1_500_000;   // D1: 2 MB je Zeile, mit Sicherheitsabstand

const ALLOWED_ORIGINS = [
  'https://leopoldkarl.com',
  'https://www.leopoldkarl.com',
  'http://127.0.0.1:8765',          // lokale Entwicklung
  'http://localhost:8765',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (request, status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
});

/**
 * Zeitkonstanter Vergleich. Ein `===` auf Zeichenketten bricht beim ersten
 * abweichenden Byte ab und verraet ueber die Laufzeit, wie weit ein geratenes
 * Token stimmt. Bei 256 Bit Zufall ist das theoretisch, kostet aber nichts.
 */
function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function authorized(request, env) {
  const expected = env.API_TOKEN;
  if (!expected) return false;                 // ohne gesetztes Geheimnis: alles zu
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return !!m && safeEqual(m[1], expected);
}

async function readRow(env) {
  const row = await env.DB.prepare(
    'SELECT version, updated_at AS updatedAt, blob FROM state WHERE id = ?',
  ).bind(ROW_ID).first();
  return row || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (url.pathname === '/health') return json(request, 200, { ok: true });
    if (url.pathname !== '/state') return json(request, 404, { error: 'Unbekannter Pfad.' });
    if (!authorized(request, env)) return json(request, 401, { error: 'Nicht angemeldet.' });

    if (request.method === 'GET') {
      const row = await readRow(env);
      if (!row) return json(request, 200, { version: 0, updatedAt: null, blob: null });
      return json(request, 200, {
        version: row.version,
        updatedAt: row.updatedAt,
        blob: JSON.parse(row.blob),
      });
    }

    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json(request, 400, { error: 'Kein JSON.' }); }
      const base = Number(body?.baseVersion);
      if (!Number.isInteger(base) || base < 0) {
        return json(request, 400, { error: 'baseVersion fehlt oder ist keine Zahl ≥ 0.' });
      }
      if (!body?.blob || typeof body.blob !== 'object') {
        return json(request, 400, { error: 'blob fehlt.' });
      }
      const text = JSON.stringify(body.blob);
      if (text.length > MAX_BLOB_BYTES) {
        return json(request, 413, { error: `Block zu groß (${text.length} Zeichen, Grenze ${MAX_BLOB_BYTES}).` });
      }

      const row = await readRow(env);
      const current = row ? row.version : 0;
      if (current !== base) {
        return json(request, 409, {
          version: current,
          updatedAt: row ? row.updatedAt : null,
          blob: row ? JSON.parse(row.blob) : null,
        });
      }

      const version = current + 1;
      const updatedAt = new Date().toISOString();
      // Ein Ausdruck statt lesen-und-schreiben: die WHERE-Bedingung prueft die
      // Version noch einmal in der Datenbank, damit zwei gleichzeitige Anfragen
      // nicht beide durchkommen.
      const res = await env.DB.prepare(
        `INSERT INTO state (id, version, updated_at, blob) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET version = ?2, updated_at = ?3, blob = ?4
         WHERE state.version = ?5`,
      ).bind(ROW_ID, version, updatedAt, text, base).run();

      const changed = res?.meta?.changes ?? res?.changes ?? 1;
      if (!changed) {
        const now = await readRow(env);
        return json(request, 409, {
          version: now ? now.version : 0,
          updatedAt: now ? now.updatedAt : null,
          blob: now ? JSON.parse(now.blob) : null,
        });
      }
      return json(request, 200, { version, updatedAt });
    }

    return json(request, 405, { error: 'Methode nicht erlaubt.' });
  },
};
