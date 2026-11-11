// projektquelle.js — offene Aufgaben aus /projekte lesen.
//
// Beide Seiten liegen auf derselben Herkunft (leopoldkarl.com), teilen sich
// also den localStorage. Der Matheplan liest den Stand von /projekte direkt
// von dort — kein Netz, keine Entschluesselung, keine zweite Kopie der
// Projektdaten.
//
// Bewusst NUR lesend. /projekte gleicht seinen Block eigenstaendig mit dem
// Worker ab und fuehrt dafuer eine Versionsnummer; schriebe der Kalender
// dazwischen, erzeugte das Konflikte in einer App, die davon nichts weiss.
// Eine Aufgabe wird deshalb hier nicht abgehakt — das passiert auf /projekte.
//
// Preis dieser Loesung: der Stand ist so frisch, wie /projekte auf diesem
// Geraet zuletzt geoeffnet war. Die Oberflaeche sagt das mit dem Zeitstempel
// des Projektstands.

export const PROJEKTE_KEY = 'projekte.state';
const AKTIV = 'aktiv';

/**
 * Rohzustand lesen.
 * @returns {{ok: boolean, grund?: string, projekte: Array<object>, stand: string|null}}
 */
export function readProjekte(storage = globalThis.localStorage) {
  let raw = null;
  try { raw = storage.getItem(PROJEKTE_KEY); } catch {
    return { ok: false, grund: 'Kein Zugriff auf den lokalen Speicher.', projekte: [], stand: null };
  }
  if (!raw) {
    return {
      ok: false,
      grund: 'Auf diesem Gerät ist noch kein Projektstand da. Einmal leopoldkarl.com/projekte öffnen.',
      projekte: [],
      stand: null,
    };
  }
  let s;
  try { s = JSON.parse(raw); } catch {
    return { ok: false, grund: 'Der Projektstand ist nicht lesbar.', projekte: [], stand: null };
  }
  const projekte = Array.isArray(s && s.projects) ? s.projects : [];
  let stand = null;
  for (const p of projekte) {
    if (typeof p.updated === 'string' && (!stand || p.updated > stand)) stand = p.updated;
  }
  return { ok: true, projekte, stand };
}

/**
 * Offene Aufgaben aller laufenden Projekte, flach und anzeigefertig.
 *
 * Sortierung: Projekte nach Faelligkeit ihres naechsten offenen Meilensteins,
 * innerhalb des Projekts nach Meilenstein-Faelligkeit und Reihenfolge. Was
 * zuerst faellig ist, steht oben — das ist die Reihenfolge, in der man beim
 * Planen danach greift.
 */
export function offeneAufgaben(projekte, { nurAktive = true } = {}) {
  const out = [];
  for (const p of projekte) {
    if (nurAktive && p.status !== AKTIV) continue;
    const ms = Array.isArray(p.milestones) ? p.milestones : [];
    for (const m of ms) {
      const tasks = Array.isArray(m.tasks) ? m.tasks : [];
      if (!tasks.length) {
        // Meilenstein ohne Aufgaben zaehlt in /projekte als eine Einheit und
        // ist direkt abhakbar — hier also selbst planbar.
        if (m.done) continue;
        out.push({
          projectId: p.id,
          projectTitle: p.title,
          color: p.color,
          milestoneId: m.id,
          milestoneTitle: m.title,
          taskId: null,
          title: m.title,
          weight: 1,
          due: m.due || p.due || null,
        });
        continue;
      }
      for (const t of tasks) {
        if (t.done) continue;
        out.push({
          projectId: p.id,
          projectTitle: p.title,
          color: p.color,
          milestoneId: m.id,
          milestoneTitle: m.title,
          taskId: t.id,
          title: t.title || m.title,
          weight: Number(t.weight) || 1,
          due: m.due || p.due || null,
        });
      }
    }
  }
  const rang = (d) => (d ? d : '9999-99-99');
  out.sort((a, b) => rang(a.due).localeCompare(rang(b.due))
    || String(a.projectTitle).localeCompare(String(b.projectTitle), 'de')
    || String(a.title).localeCompare(String(b.title), 'de'));
  return out;
}

/** Ist diese Aufgabe inzwischen erledigt? Fuer bereits geplante Bloecke. */
export function aufgabeErledigt(projekte, plan) {
  if (!plan || !plan.projectId) return false;
  const p = projekte.find((x) => x.id === plan.projectId);
  if (!p) return false;
  const m = (p.milestones || []).find((x) => x.id === plan.milestoneId);
  if (!m) return false;
  if (!plan.taskId) return !!m.done;
  const t = (m.tasks || []).find((x) => x.id === plan.taskId);
  return !!(t && t.done);
}
