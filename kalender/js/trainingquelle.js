// trainingquelle.js — das Ist des Trainingsplans aus /training holen.
//
// Die Trainingsdaten liegen verschluesselt unter /training/data/; das Modul
// /training/js/source.js kann sie lesen und haelt den abgeleiteten Schluessel
// als nicht exportierbaren CryptoKey in IndexedDB („training-keys"). Da beide
// Seiten dieselbe Herkunft haben, laesst sich dieses Modul hier einfach
// importieren — der Kalender bekommt damit Zugriff auf die Aktivitaeten,
// ohne Crypto, Dateiformat oder Schluesselhaltung zu kennen oder zu kopieren.
//
// Entsperrt wird nicht hier: ist kein Schluessel hinterlegt, meldet die
// Quelle `gesperrt`, und der Trainingsplan verweist auf /training. Eine
// zweite Passphrase-Eingabe an zweiter Stelle waere eine zweite Stelle, an
// der man sie falsch behandeln kann.

const MODUL = '/training/js/source.js';

/**
 * @typedef {'ok'|'gesperrt'|'keine'|'fehler'} Zustand
 * @typedef {{zustand: Zustand, grund?: string, acts: Array<object>, stand: string|null}} Ergebnis
 */

let cache = null;          // letzte erfolgreiche Antwort
let laeuft = null;         // laufende Anfrage, damit sich Aufrufe nicht ueberholen

/** Nur fuer Tests: statt des echten Moduls etwas anderes laden lassen. */
let importer = () => import(/* @vite-ignore */ MODUL);
export function setImporter(fn) { importer = fn; cache = null; laeuft = null; }

export function clearCache() { cache = null; }

/**
 * Aktivitaeten laden. Liefert immer ein Ergebnis, wirft nicht — die Seite
 * soll auch dann stehen, wenn /training fehlt, gesperrt oder kaputt ist.
 * @returns {Promise<Ergebnis>}
 */
export async function ladeAktivitaeten({ force = false } = {}) {
  if (cache && !force) return cache;
  if (laeuft) return laeuft;
  laeuft = hole(force).finally(() => { laeuft = null; });
  return laeuft;
}

async function hole(force) {
  let S;
  try {
    S = await importer();
  } catch {
    return { zustand: 'keine', grund: 'Die Trainingsseite ist von hier aus nicht erreichbar.', acts: [], stand: null };
  }
  try {
    await S.loadManifest();
  } catch (e) {
    return { zustand: 'keine', grund: nachricht(e, 'Keine Trainingsdaten vorhanden.'), acts: [], stand: null };
  }
  try {
    if (S.isEncrypted() && !(await S.restoreKey())) {
      return {
        zustand: 'gesperrt',
        grund: 'Die Trainingsdaten sind gesperrt. Einmal leopoldkarl.com/training öffnen und entsperren.',
        acts: [], stand: null,
      };
    }
    // Das Modul haelt den Index selbst zwischen; bei `force` an ihm vorbei.
    const index = await S.loadIndex(force);
    const acts = Array.isArray(index && index.activities) ? index.activities : [];
    const erg = { zustand: 'ok', acts, stand: (index && index.generated) || null };
    cache = erg;
    return erg;
  } catch (e) {
    // LockedError und WrongPassphraseError kommen aus demselben Modul; der
    // Name reicht, ohne die Klassen zu importieren.
    const name = e && e.constructor ? e.constructor.name : '';
    if (name === 'LockedError' || name === 'WrongPassphraseError') {
      return {
        zustand: 'gesperrt',
        grund: 'Die Trainingsdaten sind gesperrt. Einmal leopoldkarl.com/training öffnen und entsperren.',
        acts: [], stand: null,
      };
    }
    return { zustand: 'fehler', grund: nachricht(e, 'Trainingsdaten nicht lesbar.'), acts: [], stand: null };
  }
}

const nachricht = (e, dflt) => (e && e.message ? String(e.message) : dflt);

/**
 * Aktivitaeten einer Woche nach Sportart zusammenfassen.
 *
 * `moving` ist die Bewegungszeit in Sekunden, `dist` die Strecke in Metern —
 * so liefert es die Trainingsseite. Hier wird in Minuten und Kilometer
 * umgerechnet, weil im Plan so geplant wird.
 *
 * @param {Array<object>} acts
 * @param {string} vonYmd  erster Tag (einschliesslich)
 * @param {string} bisYmd  letzter Tag (einschliesslich)
 */
export function wochenIst(acts, vonYmd, bisYmd) {
  const out = {};
  let gesamtMin = 0;
  for (const a of acts) {
    const tag = String(a.start || '').slice(0, 10);
    if (!tag || tag < vonYmd || tag > bisYmd) continue;
    const sport = ['run', 'ride', 'swim', 'strength', 'other'].includes(a.cat) ? a.cat : 'other';
    const min = Math.round((Number(a.moving) || 0) / 60);
    const km = (Number(a.dist) || 0) / 1000;
    if (!out[sport]) out[sport] = { min: 0, km: 0, n: 0 };
    out[sport].min += min;
    out[sport].km += km;
    out[sport].n += 1;
    gesamtMin += min;
  }
  for (const v of Object.values(out)) v.km = Math.round(v.km * 10) / 10;
  return { sportarten: out, gesamtMin };
}

/** Aktivitaeten eines einzelnen Tages, fuer die Spaltenfusszeile. */
export function tagesIst(acts, ymdTag) {
  return acts
    .filter((a) => String(a.start || '').slice(0, 10) === ymdTag)
    .map((a) => ({
      id: a.id,
      sport: ['run', 'ride', 'swim', 'strength', 'other'].includes(a.cat) ? a.cat : 'other',
      titel: a.name || '',
      min: Math.round((Number(a.moving) || 0) / 60),
      km: Math.round(((Number(a.dist) || 0) / 1000) * 10) / 10,
    }));
}
