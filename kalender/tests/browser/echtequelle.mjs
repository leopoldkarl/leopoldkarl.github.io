// echtequelle.mjs — der Trainingsplan mit dem echten Modul von /training.
//
// Die übrigen Prüfungen tauschen den Lader gegen eine Attrappe; damit
// bliebe unbemerkt, wenn das echte Modul aus /kalender/ heraus seine Daten
// am falschen Ort sucht (so war es zunächst: ./data/ relativ zur *Seite*).
// Entschlüsseln kann die Prüfung nicht — sie hat die Passphrase nicht und
// soll sie nicht haben. Erwartet wird deshalb „gesperrt“, nicht „keine Daten“:
// Das beweist, dass Manifest und Verschlüsselungsangabe gefunden wurden.

import { chromium as holeChromium } from '../_playwright.mjs';

const BASIS = process.env.KALENDER_URL || 'http://127.0.0.1:8765/kalender/index.html';
const chromium = await holeChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
ctx.setDefaultTimeout(8000);

const checks = [];
const check = async (name, fn) => {
  try { const v = await fn(); checks.push([name, v === true ? 'ok' : `FEHLER: ${v}`]); }
  catch (e) { checks.push([name, `FEHLER: ${e.message}`]); }
};

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await check('Die Trainingsseite selbst findet ihre Daten weiterhin', async () => {
  await page.goto(new URL('/training/', BASIS).href, { waitUntil: 'networkidle' });
  const r = await page.evaluate(async () => {
    const S = await import('/training/js/source.js');
    const m = await S.loadManifest();
    return { format: m.format, verschluesselt: S.isEncrypted() };
  });
  return r.format === 'lkt-training' ? true : JSON.stringify(r);
});

await check('Vom Kalender aus: Daten gefunden, Zustand „gesperrt“', async () => {
  await page.goto(`${BASIS}#trainingsplan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const bar = await page.textContent('#tr-root .pl-bar');
  return /gesperrt/.test(bar) ? true : `"${bar}"`;
});

await check('Dabei wird nichts unter /kalender/data/ gesucht', async () => {
  const falsch = [];
  page.on('request', (r) => { if (r.url().includes('/kalender/data/')) falsch.push(r.url()); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return falsch.length === 0 ? true : falsch.join(', ');
});

console.log('\nFunktionsprüfungen (echte Trainingsquelle):');
for (const [n, r] of checks) console.log(`  ${r === 'ok' ? 'ok ' : '‼  '} ${n}${r === 'ok' ? '' : ' — ' + r}`);
if (errors.length) { errors.forEach((e) => console.log('  ‼ ' + e)); process.exitCode = 1; }
if (checks.some(([, r]) => r !== 'ok')) process.exitCode = 1;
await browser.close();
