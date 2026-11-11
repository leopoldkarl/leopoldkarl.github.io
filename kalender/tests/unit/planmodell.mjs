// planmodell.mjs — reine Funktionen hinter Matheplan und Trainingsplan.

import assert from 'node:assert/strict';
import { normalizePlan, normalizeEvent, migrate, SPORTS } from '../../js/store.js';
import { readProjekte, offeneAufgaben, aufgabeErledigt } from '../../js/projektquelle.js';
import { wochenIst, tagesIst } from '../../js/trainingquelle.js';

let passed = 0;
export function t(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

console.log('\n— Plan-Angaben am Termin —');

t('Ohne plan bleibt ein Termin ein gewöhnlicher Termin', () => {
  assert.equal(normalizeEvent({ start: '2026-11-11T09:00', end: '2026-11-11T10:00' }).plan, null);
  assert.equal(normalizePlan(undefined), null);
  assert.equal(normalizePlan({ kind: 'unsinn' }), null);
});

t('Mathe-Plan behält nur den Projektbezug', () => {
  const p = normalizePlan({
    kind: 'mathe', projectId: 'p1', milestoneId: 'm1', taskId: 't1',
    projectTitle: 'CSP-Dichotomie', sport: 'run', km: 10,
  });
  assert.deepEqual(p, {
    kind: 'mathe', projectId: 'p1', milestoneId: 'm1', taskId: 't1', projectTitle: 'CSP-Dichotomie',
  });
});

t('Trainings-Plan prüft Sportart, Intensität und Distanz', () => {
  assert.deepEqual(normalizePlan({ kind: 'training', sport: 'run', intensity: 'schwelle', km: 12.345 }),
    { kind: 'training', sport: 'run', intensity: 'schwelle', km: 12.35 });
  // Unbekannte Sportart fällt auf 'other', unsinnige Angaben fallen weg.
  assert.deepEqual(normalizePlan({ kind: 'training', sport: 'quidditch', intensity: 'brutal', km: -3 }),
    { kind: 'training', sport: 'other' });
});

t('Der Plan überlebt das Laden (migrate)', () => {
  const s = migrate({
    events: [{
      id: 'e1', title: 'Lesen', start: '2026-11-11T09:00', end: '2026-11-11T10:30',
      category: 'forschung', plan: { kind: 'mathe', projectId: 'p1', projectTitle: 'X' },
    }],
  });
  assert.equal(s.events[0].plan.kind, 'mathe');
  assert.equal(s.events[0].plan.projectTitle, 'X');
});

t('Wochenziele werden beim Laden geprüft', () => {
  const s = migrate({ settings: { trainingZiele: { run: '240', quidditch: 100, swim: -5, ride: 0 } } });
  assert.deepEqual(s.settings.trainingZiele, { run: 240 });
  assert.deepEqual(SPORTS, ['run', 'ride', 'swim', 'strength', 'other']);
});

console.log('\n— Projektaufgaben —');

const projektStand = {
  schema: 1,
  projects: [
    {
      id: 'p1', title: 'CSP-Dichotomie', status: 'aktiv', color: '#0ea5a4', updated: '2026-11-09T10:00:00Z',
      milestones: [
        {
          id: 'm1', title: 'Literatur', due: '2026-11-20', done: false,
          tasks: [
            { id: 't1', title: 'Barto–Kozik lesen', done: false, weight: 3 },
            { id: 't2', title: 'Notizen tippen', done: true, weight: 1 },
          ],
        },
        { id: 'm2', title: 'Beweisskizze', due: '2026-11-15', done: false, tasks: [] },
      ],
    },
    {
      id: 'p2', title: 'Altes Projekt', status: 'abgeschlossen', color: '#db2777', updated: '2026-10-01T10:00:00Z',
      milestones: [{ id: 'm3', title: 'Rest', due: '2026-11-01', done: false, tasks: [{ id: 't3', title: 'Egal', done: false, weight: 1 }] }],
    },
  ],
};

const fakeStorage = (raw) => ({ getItem: () => raw });

t('Fehlender Projektstand wird als solcher gemeldet, nicht als leer', () => {
  const r = readProjekte(fakeStorage(null));
  assert.equal(r.ok, false);
  assert.match(r.grund, /projekte/);
  assert.deepEqual(r.projekte, []);
});

t('Kaputter Projektstand wirft nicht', () => {
  const r = readProjekte(fakeStorage('{kein json'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.projekte, []);
});

t('Gelesen werden nur offene Aufgaben laufender Projekte', () => {
  const r = readProjekte(fakeStorage(JSON.stringify(projektStand)));
  assert.equal(r.ok, true);
  assert.equal(r.stand, '2026-11-09T10:00:00Z');
  const a = offeneAufgaben(r.projekte);
  assert.deepEqual(a.map((x) => x.title), ['Beweisskizze', 'Barto–Kozik lesen']);
  // Erledigtes, abgeschlossene Projekte: nicht dabei.
  assert.ok(!a.some((x) => x.title === 'Notizen tippen'));
  assert.ok(!a.some((x) => x.projectTitle === 'Altes Projekt'));
});

t('Ein Meilenstein ohne Aufgaben ist selbst planbar', () => {
  const a = offeneAufgaben(projektStand.projects);
  const m = a.find((x) => x.title === 'Beweisskizze');
  assert.equal(m.taskId, null);
  assert.equal(m.milestoneId, 'm2');
  assert.equal(m.due, '2026-11-15');
});

t('Früher Fälliges steht oben', () => {
  const a = offeneAufgaben(projektStand.projects);
  assert.equal(a[0].due, '2026-11-15');
});

t('Ein abgehakter Bezug wird erkannt', () => {
  const ps = projektStand.projects;
  assert.equal(aufgabeErledigt(ps, { projectId: 'p1', milestoneId: 'm1', taskId: 't2' }), true);
  assert.equal(aufgabeErledigt(ps, { projectId: 'p1', milestoneId: 'm1', taskId: 't1' }), false);
  assert.equal(aufgabeErledigt(ps, { projectId: 'weg', milestoneId: 'm1', taskId: 't1' }), false);
  assert.equal(aufgabeErledigt(ps, null), false);
});

console.log('\n— Trainings-Ist —');

const acts = [
  { id: 'a1', start: '2026-11-09T07:00:00', cat: 'run', moving: 3600, dist: 12000, name: 'Dauerlauf' },
  { id: 'a2', start: '2026-11-09T18:00:00', cat: 'strength', moving: 1800, dist: 0 },
  { id: 'a3', start: '2026-11-12T07:00:00', cat: 'ride', moving: 5400, dist: 45000 },
  { id: 'a4', start: '2026-11-16T07:00:00', cat: 'run', moving: 1800, dist: 6000 },   // nächste Woche
  { id: 'a5', start: '2026-11-10T07:00:00', cat: 'unbekannt', moving: 600, dist: 0 },
];

t('Die Woche summiert je Sportart in Minuten und Kilometern', () => {
  const w = wochenIst(acts, '2026-11-09', '2026-11-15');
  assert.deepEqual(w.sportarten.run, { min: 60, km: 12, n: 1 });
  assert.deepEqual(w.sportarten.ride, { min: 90, km: 45, n: 1 });
  assert.equal(w.sportarten.strength.min, 30);
  assert.equal(w.gesamtMin, 190);
});

t('Aktivitäten außerhalb der Woche zählen nicht', () => {
  const w = wochenIst(acts, '2026-11-09', '2026-11-15');
  assert.equal(w.sportarten.run.n, 1);
});

t('Unbekannte Sportart landet unter Sonstiges', () => {
  const w = wochenIst(acts, '2026-11-09', '2026-11-15');
  assert.equal(w.sportarten.other.min, 10);
});

t('Der Tag liefert die einzelnen Aktivitäten', () => {
  const tag = tagesIst(acts, '2026-11-09');
  assert.equal(tag.length, 2);
  assert.deepEqual(tag[0], { id: 'a1', sport: 'run', titel: 'Dauerlauf', min: 60, km: 12 });
});

t('Ohne Aktivitäten bleibt alles leer, ohne Fehler', () => {
  const w = wochenIst([], '2026-11-09', '2026-11-15');
  assert.deepEqual(w, { sportarten: {}, gesamtMin: 0 });
  assert.deepEqual(tagesIst([], '2026-11-09'), []);
});

console.log(`\n${passed} Prüfungen bestanden.\n`);
