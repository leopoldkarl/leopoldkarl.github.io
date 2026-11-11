// planseiten.mjs — Matheplan und Trainingsplan im Browser.
//
// Der Server läuft auf der Repo-Wurzel, die App also unter /kalender/.
// Projektstand kommt als vorbereiteter localStorage-Eintrag; die
// Trainingsdaten über eine Attrappe, die statt /training/js/source.js
// geladen wird (setImporter) — echte Daten sind verschlüsselt und haben in
// einer Prüfung nichts verloren.

import { chromium as holeChromium } from '../_playwright.mjs';

const BASIS = process.env.KALENDER_URL || 'http://127.0.0.1:8765/kalender/index.html';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const HEUTE = new Date();
const MONTAG = addDays(HEUTE, -((HEUTE.getDay() + 6) % 7));
const MO = ymd(MONTAG);
const MI = ymd(addDays(MONTAG, 2));
const T = ymd(HEUTE);

const seed = {
  version: 3,
  categories: [
    { id: 'forschung', name: 'Forschung', color: '#0ea5a4' },
    { id: 'sport', name: 'Sport', color: '#f59e0b' },
    { id: 'sonstiges', name: 'Sonstiges', color: '#64748b' },
  ],
  settings: { defaultCategory: 'forschung', scrollHour: 7, trainingZiele: {} },
  events: [], tasks: [], journal: {}, planTemplates: [], weekPlans: {}, dayPlans: {},
};

const projekte = {
  schema: 1,
  projects: [{
    id: 'p1', title: 'CSP-Dichotomie', status: 'aktiv', color: '#0ea5a4',
    updated: '2026-11-09T10:00:00Z',
    milestones: [{
      id: 'm1', title: 'Literatur', due: '2099-01-20', done: false,
      tasks: [
        { id: 't1', title: 'Barto–Kozik lesen', done: false, weight: 3 },
        { id: 't2', title: 'Schon erledigt', done: true, weight: 1 },
      ],
    }],
  }],
};

// Attrappe für /training/js/source.js: zwei Aktivitäten in dieser Woche.
const TRAINING_STUB = `
  export class LockedError extends Error {}
  export class NoDataError extends Error {}
  export class WrongPassphraseError extends Error {}
  export async function loadManifest() { return { format: 'lkt-training', mode: 'encrypted' }; }
  export function isEncrypted() { return true; }
  export async function restoreKey() { return true; }
  export async function loadIndex() {
    return { generated: '2026-11-10T06:00:00Z', activities: [
      { id: 'a1', start: '${MO}T07:00:00', cat: 'run', moving: 3600, dist: 12000, name: 'Dauerlauf' },
      { id: 'a2', start: '${MI}T18:00:00', cat: 'strength', moving: 1800, dist: 0, name: 'Kraft' },
    ] };
  }
`;

const chromium = await holeChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
ctx.setDefaultTimeout(8000);
await ctx.addInitScript(([s, p]) => {
  if (!localStorage.getItem('kalender.v1')) {
    localStorage.setItem('kalender.v1', s);
    localStorage.setItem('projekte.state', p);
    localStorage.setItem('kalender.page', 'matheplan');
  }
}, [JSON.stringify(seed), JSON.stringify(projekte)]);

const errors = [];
const page = await ctx.newPage();
page.on('console', (m) => {
  const t2 = m.text();
  if (/fonts\.googleapis|fonts\.gstatic|ERR_TUNNEL/.test(t2)) return;
  if (m.type() === 'error') errors.push(`console: ${t2}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASIS, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// Trainingsquelle auf die Attrappe umstellen, bevor die Seite sie braucht.
await page.evaluate(async (src) => {
  const q = await import('./js/trainingquelle.js');
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  q.setImporter(() => import(/* webpackIgnore: true */ url));
}, TRAINING_STUB);

const checks = [];
const check = async (name, fn) => {
  try { const v = await fn(); checks.push([name, v === true ? 'ok' : `FEHLER: ${v}`]); }
  catch (e) { checks.push([name, `FEHLER: ${e.message}`]); }
};
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('kalender.v1')));
const zurMatheSeite = async () => {
  await page.evaluate(() => { location.hash = 'matheplan'; });
  await page.waitForTimeout(400);
};
const zurTrainingsSeite = async () => {
  await page.evaluate(() => { location.hash = 'trainingsplan'; });
  await page.waitForTimeout(700);
};

/* ---- Reiter ---- */

await check('Sieben Reiter in der Reihenfolge A, TA, WP, MP, TP, TB, K', async () => {
  const t2 = await page.locator('nav.pages button').allTextContents();
  return t2.join(' ') === 'A TA WP MP TP TB K' ? true : t2.join(' ');
});

await check('Ziffern 1…7 springen auf die Seiten, 4 auf den Matheplan', async () => {
  await page.locator('body').press('7');
  await page.waitForTimeout(250);
  const k = await page.evaluate(() => document.querySelector('[data-pageid="kalender"]').hidden);
  await page.locator('body').press('4');
  await page.waitForTimeout(300);
  const mp = await page.evaluate(() => !document.querySelector('[data-pageid="matheplan"]').hidden);
  return (!k && mp) ? true : `Kalender versteckt=${k}, MP sichtbar=${mp}`;
});

/* ---- Matheplan ---- */

await check('Matheplan zeigt sieben Tagesspalten', async () => {
  await zurMatheSeite();
  const n = await page.locator('#mp-root .pl-col').count();
  return n === 7 ? true : `${n} Spalten`;
});

await check('Offene Projektaufgaben stehen rechts, erledigte nicht', async () => {
  const titel = await page.locator('#mp-root .mp-tasktitle').allTextContents();
  return (titel.includes('Barto–Kozik lesen') && !titel.includes('Schon erledigt'))
    ? true : titel.join(' | ');
});

await check('Klick auf eine Projektaufgabe legt einen Block am gewählten Tag an', async () => {
  await page.locator('#mp-root .mp-task').first().click();
  await page.waitForTimeout(600);
  const s = await store();
  const ev = s.events.find((x) => x.title === 'Barto–Kozik lesen');
  return (ev && ev.start.slice(0, 10) === T && ev.plan.kind === 'mathe'
          && ev.plan.projectId === 'p1' && ev.plan.projectTitle === 'CSP-Dichotomie')
    ? true : JSON.stringify(ev);
});

await check('Der Block ist ein echter Kalendertermin und steht unter K', async () => {
  await page.evaluate(() => { location.hash = 'kalender'; });
  await page.waitForTimeout(500);
  await page.locator('body').press('w');
  await page.waitForTimeout(400);
  const n = await page.locator('#viewport .block', { hasText: 'Barto–Kozik lesen' }).count();
  return n >= 1 ? true : 'nicht in der Wochenansicht des Kalenders';
});

await check('Der Block nennt das Projekt', async () => {
  await zurMatheSeite();
  const txt = await page.locator('#mp-root .mp-ref').first().textContent();
  return /CSP-Dichotomie/.test(txt) ? true : `"${txt}"`;
});

await check('Eigener Block über das Feld der Spalte', async () => {
  const feld = page.locator(`#mp-root [data-mpadd="${MO}"]`);
  await feld.fill('Eigener Block');
  await feld.press('Enter');
  await page.waitForTimeout(600);
  const s = await store();
  const ev = s.events.find((x) => x.title === 'Eigener Block');
  return (ev && ev.start === `${MO}T09:00` && ev.end === `${MO}T10:30` && ev.plan.kind === 'mathe')
    ? true : JSON.stringify(ev);
});

await check('Ein zweiter Block schließt an den ersten an', async () => {
  const feld = page.locator(`#mp-root [data-mpadd="${MO}"]`);
  await feld.fill('Zweiter Block');
  await feld.press('Enter');
  await page.waitForTimeout(600);
  const s = await store();
  const ev = s.events.find((x) => x.title === 'Zweiter Block');
  return (ev && ev.start === `${MO}T10:30`) ? true : JSON.stringify(ev);
});

await check('Zeit ändern verschiebt den Block, die Dauer bleibt', async () => {
  const s0 = await store();
  const id = s0.events.find((x) => x.title === 'Eigener Block').id;
  const feld = page.locator(`#mp-root [data-mp="${id}"][data-mpfield="start"]`);
  await feld.fill('1300');
  await feld.press('Tab');
  await page.waitForTimeout(600);
  const s = await store();
  const ev = s.events.find((x) => x.id === id);
  return (ev.start === `${MO}T13:00` && ev.end === `${MO}T14:30`) ? true : JSON.stringify(ev);
});

await check('Löschen entfernt den Termin ganz', async () => {
  const s0 = await store();
  const id = s0.events.find((x) => x.title === 'Zweiter Block').id;
  await page.locator(`#mp-root .mp-block:has([data-mp="${id}"])`).first().hover();
  await page.locator(`#mp-root [data-mpdel="${id}"]`).click();
  await page.waitForTimeout(500);
  const s = await store();
  return !s.events.some((x) => x.id === id) ? true : 'Termin steht noch';
});

await check('Strg+Z holt den gelöschten Block zurück', async () => {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.locator('body').press('Control+z');
  await page.waitForTimeout(500);
  const s = await store();
  return s.events.some((x) => x.title === 'Zweiter Block') ? true : 'Block fehlt';
});

/* ---- Trainingsplan ---- */

await check('Trainingsplan zeigt das Ist aus den Trainingsdaten', async () => {
  await zurTrainingsSeite();
  const bar = await page.textContent('#tr-root .pl-bar');
  // 60 min Laufen + 30 min Kraft in dieser Woche
  return /Ist 1:30/.test(bar) ? true : `Leiste: "${bar}"`;
});

await check('Je Sportart eine Kachel mit geplant und Ist', async () => {
  const kacheln = await page.locator('#tr-root .tr-kachel-top').allTextContents();
  return (kacheln.includes('Laufen') && kacheln.includes('Kraft')) ? true : kacheln.join(' | ');
});

await check('Der Tag zeigt die tatsächlichen Aktivitäten', async () => {
  const txt = await page.locator(`#tr-root .pl-col[data-trkey="${MO}"] .tr-ist`).textContent();
  return /Laufen/.test(txt) && /60 min/.test(txt) ? true : `"${txt}"`;
});

await check('Neue Einheit anlegen', async () => {
  const feld = page.locator(`#tr-root [data-tradd="${MI}"]`);
  await feld.fill('Intervalle');
  await feld.press('Enter');
  await page.waitForTimeout(600);
  const s = await store();
  const ev = s.events.find((x) => x.title === 'Intervalle');
  return (ev && ev.plan.kind === 'training' && ev.plan.sport === 'run'
          && ev.start === `${MI}T17:00` && ev.end === `${MI}T18:00` && ev.category === 'sport')
    ? true : JSON.stringify(ev);
});

await check('Dauer ändern verschiebt das Ende', async () => {
  const s0 = await store();
  const id = s0.events.find((x) => x.title === 'Intervalle').id;
  const feld = page.locator(`#tr-root [data-tr="${id}"][data-trfield="dauer"]`);
  await feld.fill('75');
  await feld.press('Tab');
  await page.waitForTimeout(600);
  const s = await store();
  const ev = s.events.find((x) => x.id === id);
  return ev.end === `${MI}T18:15` ? true : JSON.stringify(ev);
});

await check('Sportart und Intensität werden gespeichert', async () => {
  const s0 = await store();
  const id = s0.events.find((x) => x.title === 'Intervalle').id;
  await page.selectOption(`#tr-root [data-tr="${id}"][data-trfield="sport"]`, 'ride');
  await page.waitForTimeout(500);
  await page.locator(`#tr-root [data-tr="${id}"][data-trint="hart"]`).click();
  await page.waitForTimeout(500);
  const s = await store();
  const ev = s.events.find((x) => x.id === id);
  return (ev.plan.sport === 'ride' && ev.plan.intensity === 'hart') ? true : JSON.stringify(ev.plan);
});

await check('Ein zweiter Klick auf dieselbe Intensität hebt sie auf', async () => {
  const s0 = await store();
  const id = s0.events.find((x) => x.title === 'Intervalle').id;
  await page.locator(`#tr-root [data-tr="${id}"][data-trint="hart"]`).click();
  await page.waitForTimeout(500);
  const s = await store();
  return s.events.find((x) => x.id === id).plan.intensity === undefined
    ? true : 'Intensität steht noch';
});

await check('Wochenziel setzen zeigt eine Leiste', async () => {
  const feld = page.locator('#tr-root .tr-kachel.tr-run .tr-ziel');
  await feld.fill('120');
  await feld.press('Tab');
  await page.waitForTimeout(600);
  const s = await store();
  const breite = await page.locator('#tr-root .tr-kachel.tr-run .tr-barfill').getAttribute('style');
  return (s.settings.trainingZiele.run === 120 && /50%/.test(breite))
    ? true : `Ziel ${JSON.stringify(s.settings.trainingZiele)}, Leiste ${breite}`;
});

await check('Einheiten stehen ebenfalls im Kalender', async () => {
  await page.evaluate(() => { location.hash = 'kalender'; });
  await page.waitForTimeout(500);
  const n = await page.locator('#viewport .block', { hasText: 'Intervalle' }).count();
  return n >= 1 ? true : 'Einheit fehlt im Kalender';
});

/* ---- Fremddaten fehlen ---- */


await check('Titel umbenennen: Enter übernimmt, kein Zeilenumbruch im Titel', async () => {
  await zurMatheSeite();
  const s0 = await store();
  const id = s0.events.find((x) => x.title === 'Eigener Block').id;
  const feld = page.locator(`#mp-root [data-mp="${id}"][data-mpfield="title"]`);
  await feld.fill('Langer Titel, der in einer schmalen Spalte sicher umbrechen muss');
  await feld.press('Enter');
  await page.waitForTimeout(500);
  const s = await store();
  const ev = s.events.find((x) => x.id === id);
  const hoehe = await page.locator(`#mp-root [data-mp="${id}"][data-mpfield="title"]`).evaluate((n) => n.clientHeight);
  return (ev.title === 'Langer Titel, der in einer schmalen Spalte sicher umbrechen muss' && hoehe > 30)
    ? true : `Titel "${ev.title}", Höhe ${hoehe}px`;
});

await check('Tab von Beginn nach Ende behält den Fokus (Matheplan)', async () => {
  await zurMatheSeite();
  const s0 = await store();
  const id = s0.events.find((x) => x.title.startsWith('Langer Titel')).id;
  const feld = page.locator(`#mp-root [data-mp="${id}"][data-mpfield="start"]`);
  await feld.fill('1400');
  await feld.press('Tab');
  await page.waitForTimeout(500);
  const f = await page.evaluate(() => [document.activeElement.dataset.mp, document.activeElement.dataset.mpfield]);
  return (f[0] === id && f[1] === 'end') ? true : `Fokus auf ${JSON.stringify(f)}`;
});

await check('Tab von Dauer nach km behält den Fokus (Trainingsplan)', async () => {
  await zurTrainingsSeite();
  const s0 = await store();
  const id = s0.events.find((x) => x.title === 'Intervalle').id;
  const feld = page.locator(`#tr-root [data-tr="${id}"][data-trfield="dauer"]`);
  await feld.fill('80');
  await feld.press('Tab');
  await page.waitForTimeout(500);
  const f = await page.evaluate(() => [document.activeElement.dataset.tr, document.activeElement.dataset.trfield]);
  return (f[0] === id && f[1] === 'km') ? true : `Fokus auf ${JSON.stringify(f)}`;
});

await check('Änderung auf /projekte in einem anderen Tab erscheint im Matheplan', async () => {
  await zurMatheSeite();
  const zweiter = await ctx.newPage();
  await zweiter.goto(new URL('/kalender/kalender.css', BASIS).href);
  await zweiter.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('projekte.state'));
    p.projects[0].milestones[0].tasks.push({ id: 't9', title: 'Neu aus /projekte', done: false, weight: 1 });
    localStorage.setItem('projekte.state', JSON.stringify(p));
  });
  await zweiter.close();
  await page.waitForTimeout(500);
  const titel = await page.locator('#mp-root .mp-tasktitle').allTextContents();
  return titel.includes('Neu aus /projekte') ? true : titel.join(' | ');
});

/* ---- Ist nicht verfügbar, dann doch ---- */

// Eigene Seite: der Zwischenspeicher der ersten soll hier nicht mitspielen.
const STUB_GESPERRT = TRAINING_STUB.replace('async function restoreKey() { return true; }', 'async function restoreKey() { return false; }');
const zweite = await ctx.newPage();
zweite.on('pageerror', (e) => errors.push(`pageerror (2): ${e.message}`));
await zweite.goto(BASIS, { waitUntil: 'networkidle' });
const setzeStub = (src) => zweite.evaluate(async (code) => {
  const q = await import('./js/trainingquelle.js');
  const url = code ? URL.createObjectURL(new Blob([code], { type: 'text/javascript' })) : null;
  q.setImporter(() => (url ? import(url) : Promise.reject(new Error('kein Modul'))));
}, src);
const geheZu = async (h, ms = 600) => { await zweite.evaluate((x) => { location.hash = x; }, h); await zweite.waitForTimeout(ms); };

await check('Ohne /training bleibt die Seite stehen und sagt warum', async () => {
  await setzeStub(null);
  await geheZu('trainingsplan');
  const bar = await zweite.textContent('#tr-root .pl-bar');
  const spalten = await zweite.locator('#tr-root .pl-col').count();
  return (spalten === 7 && /Ist –/.test(bar) && /nicht erreichbar/.test(bar)) ? true : `${spalten} Spalten, "${bar}"`;
});

await check('Gesperrte Trainingsdaten verweisen auf /training', async () => {
  await setzeStub(STUB_GESPERRT);
  await geheZu('kalender', 200);
  await geheZu('trainingsplan');
  const bar = await zweite.textContent('#tr-root .pl-bar');
  return /gesperrt/.test(bar) && /training/.test(bar) ? true : `"${bar}"`;
});

await check('Nach dem Entsperren reicht ein Seitenwechsel, kein Neuladen', async () => {
  await setzeStub(TRAINING_STUB);
  await geheZu('kalender', 200);
  await geheZu('trainingsplan');
  const bar = await zweite.textContent('#tr-root .pl-bar');
  return /Ist 1:30/.test(bar) ? true : `"${bar}"`;
});

await check('Ein gültiges Ist wird beim bloßen Neuzeichnen nicht neu geholt', async () => {
  // Wer jetzt den Lader kaputt macht, darf auf derselben Seite nichts merken.
  await setzeStub(null);
  await geheZu('kalender', 200);
  await geheZu('trainingsplan');
  const bar = await zweite.textContent('#tr-root .pl-bar');
  return /Ist 1:30/.test(bar) ? true : `"${bar}"`;
});
await zweite.close();

await check('Ohne Projektstand bleibt der Matheplan bedienbar', async () => {
  await page.evaluate(() => localStorage.removeItem('projekte.state'));
  await page.evaluate(() => { location.hash = 'kalender'; });
  await page.waitForTimeout(200);
  await zurMatheSeite();
  const hinweis = await page.textContent('#mp-root .mp-tasks');
  const spalten = await page.locator('#mp-root .pl-col').count();
  const feld = page.locator(`#mp-root [data-mpadd="${MO}"]`);
  await feld.fill('Geht trotzdem');
  await feld.press('Enter');
  await page.waitForTimeout(500);
  const s = await store();
  return (spalten === 7 && /projekte/.test(hinweis) && s.events.some((x) => x.title === 'Geht trotzdem'))
    ? true : `"${hinweis.slice(0, 60)}"`;
});

console.log('\nFunktionsprüfungen:');
for (const [n, r] of checks) console.log(`  ${r === 'ok' ? 'ok ' : '‼  '} ${n}${r === 'ok' ? '' : ' — ' + r}`);
console.log('\nKonsole:');
if (errors.length) { errors.forEach((e) => console.log('  ‼ ' + e)); process.exitCode = 1; }
else console.log('  keine Fehler');
if (checks.some(([, r]) => r !== 'ok')) process.exitCode = 1;
await browser.close();
