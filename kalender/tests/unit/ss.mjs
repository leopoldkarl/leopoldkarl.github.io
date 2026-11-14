// ss.mjs — reine Funktionen hinter der SS-Seite.

import assert from 'node:assert/strict';
import { normalizeSs, migrate, Store } from '../../js/store.js';
import { parseStunden, fmtStunden, tagesSumme, SS_FELDER } from '../../js/ss.js';

let passed = 0;
function t(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

console.log('\n— SS: Stunden lesen und schreiben —');

t('Dezimal mit Komma oder Punkt, mit oder ohne h', () => {
  assert.equal(parseStunden('1,5'), 1.5);
  assert.equal(parseStunden('1.5'), 1.5);
  assert.equal(parseStunden('2h'), 2);
  assert.equal(parseStunden(' 2 h '), 2);
});

t('Stunden:Minuten und Minuten', () => {
  assert.equal(parseStunden('1:30'), 1.5);
  assert.equal(parseStunden('0:45'), 0.75);
  assert.equal(parseStunden('90min'), 1.5);
  assert.equal(parseStunden('45 m'), 0.75);
});

t('Leer ist null Stunden, Unsinn ist null (nicht lesbar)', () => {
  assert.equal(parseStunden(''), 0);
  assert.equal(parseStunden('   '), 0);
  assert.equal(parseStunden('zwei'), null);
  assert.equal(parseStunden('1:75'), null);
  assert.equal(parseStunden('-1'), null);
});

t('Ausgabe mit Komma, ganze Zahlen ohne', () => {
  assert.equal(fmtStunden(1.5), '1,5');
  assert.equal(fmtStunden(2), '2');
  assert.equal(fmtStunden(1 / 3), '0,33');
  assert.equal(fmtStunden(0), '0');
});

t('Tagessumme über alle Felder', () => {
  assert.equal(tagesSumme({ mr: { h: 2.5 }, paper: { h: 2, text: 'x' }, sonstiges: { text: 'y' } }), 4.5);
  assert.equal(tagesSumme(undefined), 0);
});

t('Acht Felder in der Reihenfolge der Skizze, IDs eindeutig', () => {
  assert.deepEqual(SS_FELDER.map((f) => f.label),
    ['Sonstiges', 'MR inkl. T1 & L1', 'Forschung', 'Paper', 'MP inkl. K/L', 'Lektüre', 'Forschung', 'AR inkl. T2']);
  assert.equal(new Set(SS_FELDER.map((f) => f.id)).size, 8);
});

console.log('\n— SS: Zustand —');

t('Laden prüft den Bestand und wirft Leeres weg', () => {
  const s = normalizeSs({
    '2026-11-11': { mr: { text: 'a', h: '2.5' }, paper: { h: -1 }, leer: {}, kaputt: 7 },
    'kein-datum': { mr: { text: 'x' } },
    '2026-11-12': { mr: { text: '' } },
  });
  assert.deepEqual(s, { '2026-11-11': { mr: { text: 'a', h: 2.5 } } });
});

t('Unbekannte Feld-IDs bleiben erhalten (entferntes Feld verliert nichts)', () => {
  assert.deepEqual(normalizeSs({ '2026-11-11': { altfeld: { text: 'bleibt' } } }),
    { '2026-11-11': { altfeld: { text: 'bleibt' } } });
});

t('Ein alter Stand ohne ss lädt mit leerem ss', () => {
  assert.deepEqual(migrate({ events: [] }).ss, {});
});

const memAdapter = () => ({ load: async () => null, save: async () => true, watch: () => () => {} });

t('setSs ergänzt, und räumt leere Felder und Tage weg', () => {
  const st = new Store(memAdapter());
  st.state = migrate({});
  st.setSs('2026-11-11', 'mr', { text: 'Kapitel 3' });
  st.setSs('2026-11-11', 'mr', { h: 2 });
  assert.deepEqual(st.ssFor('2026-11-11'), { mr: { text: 'Kapitel 3', h: 2 } });
  st.setSs('2026-11-11', 'mr', { text: '' });
  assert.deepEqual(st.ssFor('2026-11-11'), { mr: { h: 2 } });
  st.setSs('2026-11-11', 'mr', { h: 0 });
  assert.deepEqual(st.state.ss, {});
});

t('Import mit Zusammenführen: fremde Tage dazu, eigene bleiben', () => {
  const st = new Store(memAdapter());
  st.state = migrate({ ss: { '2026-11-11': { mr: { text: 'lokal' } } } });
  st.importJSON(JSON.stringify({
    ss: { '2026-11-11': { mr: { text: 'fremd' } }, '2026-11-12': { ar: { h: 1 } } },
  }), { merge: true });
  assert.equal(st.ssFor('2026-11-11').mr.text, 'lokal');
  assert.equal(st.ssFor('2026-11-12').ar.h, 1);
});

console.log(`\n${passed} Prüfungen bestanden.\n`);
