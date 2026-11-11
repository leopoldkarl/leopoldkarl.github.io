// wochenplan.mjs — Rückfallprüfungen für die Wochenplanung (WP), soweit
// sie vom Umbau für MP/TP berührt wurde: Fokuserhalt beim Tab und
// Scrollposition beim Löschen.

import { chromium as holeChromium } from '../_playwright.mjs';

const BASIS = process.env.KALENDER_URL || 'http://127.0.0.1:8765/kalender/index.html';

const chromium = await holeChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 700 }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
ctx.setDefaultTimeout(8000);
await ctx.addInitScript(() => {
  if (!localStorage.getItem('kalender.page')) localStorage.setItem('kalender.page', 'wochenplanung');
});
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASIS, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const checks = [];
const check = async (name, fn) => {
  try { const v = await fn(); checks.push([name, v === true ? 'ok' : `FEHLER: ${v}`]); }
  catch (e) { checks.push([name, `FEHLER: ${e.message}`]); }
};

const ersteSpalte = () => page.locator('#wp-root [data-pladd]').first().getAttribute('data-pladd');

await check('Einträge über das Spaltenfeld anlegen', async () => {
  const key = await ersteSpalte();
  const feld = page.locator(`#wp-root [data-pladd="${key}"]`);
  for (let i = 1; i <= 25; i += 1) {
    await feld.fill(`Eintrag ${i}`);
    await feld.press('Enter');
  }
  await page.waitForTimeout(400);
  const n = await page.locator(`#wp-root .pl-list[data-plkey="${key}"] [data-pldel]`).count();
  return n >= 25 ? true : `${n} Einträge`;
});

await check('Tab von Beginn nach Ende behält den Fokus', async () => {
  const key = await ersteSpalte();
  const start = page.locator(`#wp-root .pl-list[data-plkey="${key}"] [data-plpart="start"]`).first();
  const id = await start.getAttribute('data-plitem');
  await start.fill('0800');
  await start.press('Tab');
  await page.waitForTimeout(400);
  const f = await page.evaluate(() => [document.activeElement.dataset.plitem, document.activeElement.dataset.plpart]);
  return (f[0] === id && f[1] === 'end') ? true : `Fokus auf ${JSON.stringify(f)}`;
});

await check('Löschen weit unten springt nicht an den Spaltenanfang', async () => {
  const key = await ersteSpalte();
  const list = page.locator(`#wp-root .pl-list[data-plkey="${key}"]`);
  const hoch = await list.evaluate((n) => n.scrollHeight - n.clientHeight);
  if (hoch < 100) return `Spalte scrollt nicht (Überhang ${hoch}px) — Prüfung sinnlos`;
  await list.evaluate((n) => { n.scrollTop = n.scrollHeight; });
  const vorher = await list.evaluate((n) => n.scrollTop);
  const letzter = list.locator('.pl').last();
  await letzter.hover();
  await letzter.locator('[data-pldel]').click();
  await page.waitForTimeout(400);
  const nachher = await page.locator(`#wp-root .pl-list[data-plkey="${key}"]`).evaluate((n) => n.scrollTop);
  return nachher > vorher - 80 ? true : `scrollTop ${vorher} → ${nachher}`;
});

console.log('\nFunktionsprüfungen (WP):');
for (const [n, r] of checks) console.log(`  ${r === 'ok' ? 'ok ' : '‼  '} ${n}${r === 'ok' ? '' : ' — ' + r}`);
if (errors.length) { errors.forEach((e) => console.log('  ‼ ' + e)); process.exitCode = 1; }
if (checks.some(([, r]) => r !== 'ok')) process.exitCode = 1;
await browser.close();
