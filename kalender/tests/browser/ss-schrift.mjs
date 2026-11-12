// ss-schrift.mjs — SS-Felder wachsen mit, auch wenn die Webschrift spät kommt.
//
// Der Fehler, den diese Prüfung festhält: die Höhe wurde beim ersten
// Zeichnen gemessen, noch mit der Ersatzschrift. Trifft Inter danach ein
// (font-display: swap), läuft der Text breiter, bricht öfter um, und die
// letzten Zeilen waren abgeschnitten. In der Testumgebung ist Google Fonts
// gesperrt; deshalb wird die Schrift hier nachgestellt: eine breite
// Systemschrift unter dem Namen „Inter", 1,5 s verzögert ausgeliefert.
//
// Zwei Durchläufe: mit `field-sizing: content` (der Browser macht es selbst)
// und ohne (app.js misst und muss beim Eintreffen der Schrift nachmessen).

import { readFileSync, existsSync } from 'node:fs';
import { chromium as holeChromium } from '../_playwright.mjs';

const BASIS = process.env.KALENDER_URL || 'http://127.0.0.1:8765/kalender/index.html';
const KANDIDATEN = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
  'C:/Windows/Fonts/consola.ttf',
  '/System/Library/Fonts/Menlo.ttc',
];
const pfad = KANDIDATEN.find((p) => existsSync(p));
if (!pfad) {
  console.log('\nss-schrift: keine breite Systemschrift gefunden — übersprungen.');
  process.exit(0);
}
const SCHRIFT = readFileSync(pfad);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const T = ymd(new Date());
const LANG = 'Ein ziemlich langer Eintrag, der in einem schmalen Feld über mehrere Zeilen umbricht '
  + 'und dann noch weiter geht und weiter und weiter bis zum Ende des Feldes.';

const chromium = await holeChromium();
const browser = await chromium.launch();
const checks = [];

async function lauf(ansicht, ohneFieldSizing) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({
    contentType: 'text/css',
    body: "@font-face{font-family:'Inter';font-display:swap;src:url(https://fonts.gstatic.com/attrappe/inter.ttf) format('truetype')}",
  }));
  await ctx.route('https://fonts.gstatic.com/**', async (r) => {
    await new Promise((ok) => setTimeout(ok, 1500));
    r.fulfill({ contentType: 'font/ttf', body: SCHRIFT });
  });
  await ctx.addInitScript(([s, v, ohne]) => {
    localStorage.setItem('kalender.v1', s);
    localStorage.setItem('kalender.ssview', v);
    if (ohne) {
      const orig = CSS.supports.bind(CSS);
      CSS.supports = (a, b) => (String(a).includes('field-sizing') ? false : orig(a, b));
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = 'textarea { field-sizing: fixed !important; }';
        document.head.append(st);
      });
    }
  }, [JSON.stringify({ version: 3, events: [], tasks: [], journal: {}, ss: { [T]: { paper: { text: LANG }, mr: { text: LANG } } } }),
    ansicht, ohneFieldSizing]);
  const page = await ctx.newPage();
  await page.goto(`${BASIS}#ss`, { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const r = await page.evaluate(() => ({
    schrift: document.fonts.check('16px Inter'),
    ueber: [...document.querySelectorAll('#ss-root textarea.ss-text')]
      .filter((t) => t.scrollHeight > t.clientHeight + 1)
      .map((t) => `${t.dataset.ssslot} ${t.scrollHeight}>${t.clientHeight}`),
  }));
  // Danach noch tippen: das Feld muss Zeile um Zeile mitwachsen.
  const ta = page.locator(`#ss-root textarea[data-ssday="${T}"][data-ssslot="lektuere"]`);
  await ta.click();
  await page.keyboard.type(`${LANG}\nzweite Zeile\ndritte Zeile`);
  await page.waitForTimeout(200);
  const getippt = await ta.evaluate((t) => t.scrollHeight <= t.clientHeight + 1);
  await ctx.close();
  const name = `${ansicht === 'week' ? 'Woche' : 'Tag'}, ${ohneFieldSizing ? 'gemessen (ohne field-sizing)' : 'field-sizing'}`;
  checks.push([`${name}: nach Eintreffen der Schrift nichts abgeschnitten`,
    !r.schrift ? 'FEHLER: Schrift kam nicht an — Prüfung sinnlos' : (r.ueber.length ? `FEHLER: ${r.ueber.join(', ')}` : 'ok')]);
  checks.push([`${name}: beim Tippen wächst das Feld mit`, getippt ? 'ok' : 'FEHLER: abgeschnitten']);
}

for (const ansicht of ['week', 'day']) {
  for (const ohne of [false, true]) await lauf(ansicht, ohne);
}

console.log('\nFunktionsprüfungen (SS, Schrift und Feldhöhe):');
for (const [n, r] of checks) console.log(`  ${r === 'ok' ? 'ok ' : '‼  '} ${n}${r === 'ok' ? '' : ' — ' + r}`);
if (checks.some(([, r]) => r !== 'ok')) process.exitCode = 1;
await browser.close();
