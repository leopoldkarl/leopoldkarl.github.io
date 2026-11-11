// ss.mjs — die SS-Seite im Browser.

import { chromium as holeChromium } from '../_playwright.mjs';

const BASIS = process.env.KALENDER_URL || 'http://127.0.0.1:8765/kalender/index.html';
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HEUTE = new Date();
const T = ymd(HEUTE);
const MONTAG = new Date(HEUTE.getFullYear(), HEUTE.getMonth(), HEUTE.getDate() - ((HEUTE.getDay() + 6) % 7));
const MO = ymd(MONTAG);
// Ein anderer Tag derselben Woche als heute (Montag, ausser heute ist Montag).
const ANDERER = MO === T ? ymd(new Date(MONTAG.getFullYear(), MONTAG.getMonth(), MONTAG.getDate() + 1)) : MO;

const chromium = await holeChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
ctx.setDefaultTimeout(8000);
await ctx.addInitScript(() => {
  if (!localStorage.getItem('kalender.page')) {
    localStorage.setItem('kalender.page', 'ss');
    localStorage.setItem('kalender.ssview', 'day');
  }
});
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASIS, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const checks = [];
const check = async (name, fn) => {
  try { const v = await fn(); checks.push([name, v === true ? 'ok' : `FEHLER: ${v}`]); }
  catch (e) { checks.push([name, `FEHLER: ${e.message}`]); }
};
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('kalender.v1') || '{}'));
const text = (tag, slot) => page.locator(`#ss-root textarea[data-ssday="${tag}"][data-ssslot="${slot}"]`);
const stunden = (tag, slot) => page.locator(`#ss-root input[data-ssday="${tag}"][data-ssslot="${slot}"]`);

await check('Reiter SS ganz rechts (rechts von K), Ziffer 8 springt dorthin', async () => {
  const t = await page.locator('nav.pages button').allTextContents();
  await page.locator('body').press('7');
  await page.waitForTimeout(200);
  await page.locator('body').press('8');
  await page.waitForTimeout(200);
  const sichtbar = await page.evaluate(() => !document.querySelector('#ss-root').hidden);
  return (t.join(' ') === 'A TA WP MP TP TB K SS' && sichtbar) ? true : `${t.join(' ')}, sichtbar=${sichtbar}`;
});

await check('Tagesansicht: acht Kästen, Vorgabe nur als Platzhalter', async () => {
  const n = await page.locator('#ss-root .ss-box').count();
  const ph = await text(T, 'mr').getAttribute('placeholder');
  const wert = await text(T, 'mr').inputValue();
  return (n === 8 && ph === 'MR inkl. T1 & L1\n~2–3 h' && wert === '') ? true : `${n} Kästen, "${ph}", Wert "${wert}"`;
});

await check('Eintrag wird beim Tippen gespeichert, ohne das Feld zu verlassen', async () => {
  await text(T, 'paper').click();
  await page.keyboard.type('Barto–Kozik §4');
  await page.waitForTimeout(800);
  const s = await store();
  return s.ss?.[T]?.paper?.text === 'Barto–Kozik §4' ? true : JSON.stringify(s.ss);
});

await check('… und übersteht ein Neuladen', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return (await text(T, 'paper').inputValue()) === 'Barto–Kozik §4' ? true : 'Text fehlt';
});

await check('Stunden: „1,5" und „1:30" ergeben je 1,5 h, die Tagessumme 3 h', async () => {
  await stunden(T, 'paper').fill('1,5');
  await stunden(T, 'paper').press('Enter');
  await stunden(T, 'mr').fill('1:30');
  await stunden(T, 'mr').press('Tab');
  await page.waitForTimeout(500);
  const s = await store();
  const sum = await page.textContent(`#ss-root [data-sssum="${T}"]`);
  const shown = await stunden(T, 'mr').inputValue();
  return (s.ss[T].paper.h === 1.5 && s.ss[T].mr.h === 1.5 && sum === '3 h' && shown === '1,5')
    ? true : `${JSON.stringify(s.ss[T])}, Summe "${sum}", Feld "${shown}"`;
});

await check('Unlesbare Stunden werden markiert und nicht gespeichert', async () => {
  await stunden(T, 'ar').fill('zwei');
  await stunden(T, 'ar').press('Tab');
  await page.waitForTimeout(300);
  const s = await store();
  const cls = await stunden(T, 'ar').getAttribute('class');
  return (!s.ss[T].ar && /invalid/.test(cls)) ? true : `${JSON.stringify(s.ss[T].ar)}, class "${cls}"`;
});

await check('Text leeren und Stunden löschen räumt das Feld aus dem Zustand', async () => {
  await stunden(T, 'ar').fill('');
  await stunden(T, 'ar').press('Tab');
  await text(T, 'paper').fill('');
  await text(T, 'paper').press('Tab');
  await stunden(T, 'paper').fill('');
  await stunden(T, 'paper').press('Tab');
  await page.waitForTimeout(600);
  const s = await store();
  return (!s.ss[T].paper && !s.ss[T].ar && s.ss[T].mr) ? true : JSON.stringify(s.ss[T]);
});

await check('Wochenansicht: 8 × 7 Kästen, Zeilen- und Wochensummen', async () => {
  await page.locator('[data-ssview="week"]').click();
  await page.waitForTimeout(400);
  await stunden(ANDERER, 'mr').fill('2');
  await stunden(ANDERER, 'mr').press('Tab');
  await page.waitForTimeout(400);
  const n = await page.locator('#ss-root .ss-box').count();
  const zeile = await page.textContent('#ss-root [data-ssrowsum="mr"]');
  const woche = await page.textContent('#ss-root [data-sstotal]');
  return (n === 56 && zeile === '3,5 h' && /3,5 h investiert in dieser Woche/.test(woche))
    ? true : `${n} Kästen, Zeile "${zeile}", Woche "${woche}"`;
});

await check('Langer Text wird nicht abgeschnitten', async () => {
  const lang = 'Lemma 3.2: Gegenbeispiel für n = 4 suchen, dann den Induktionsschritt neu aufschreiben';
  await text(ANDERER, 'forschung1').fill(lang);
  await page.waitForTimeout(200);
  const r = await text(ANDERER, 'forschung1').evaluate((n) => [n.scrollHeight, n.clientHeight]);
  return r[0] <= r[1] + 1 ? true : `scrollHeight ${r[0]} > clientHeight ${r[1]}`;
});

await check('Klick auf den Tageskopf öffnet diesen Tag', async () => {
  await page.locator(`#ss-root [data-ssgoto="${ANDERER}"]`).click();
  await page.waitForTimeout(400);
  const boxen = await page.locator('#ss-root .ss-box').count();
  const wert = await text(ANDERER, 'forschung1').inputValue();
  return (boxen === 8 && /Lemma 3\.2/.test(wert)) ? true : `${boxen} Kästen, "${wert.slice(0, 20)}"`;
});

await check('Tasten W und D schalten die Ansicht', async () => {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.locator('body').press('w');
  await page.waitForTimeout(300);
  const w = await page.locator('#ss-root .ss-box').count();
  await page.locator('body').press('d');
  await page.waitForTimeout(300);
  const d = await page.locator('#ss-root .ss-box').count();
  return (w === 56 && d === 8) ? true : `W: ${w}, D: ${d}`;
});

await check('Tippen in SS löst keine Tastenkürzel aus', async () => {
  await text(ANDERER, 'sonstiges').click();
  await page.keyboard.type('w8d');
  await page.waitForTimeout(600);
  const sichtbar = await page.evaluate(() => !document.querySelector('#ss-root').hidden);
  const n = await page.locator('#ss-root .ss-box').count();
  return (sichtbar && n === 8) ? true : `SS sichtbar=${sichtbar}, ${n} Kästen`;
});

await check('Neuladen direkt nach dem Tippen verliert nichts', async () => {
  // Schneller als die Entprellung: es muss das Festschreiben beim Entladen
  // greifen, nicht der Zeitgeber.
  await text(ANDERER, 'lektuere').click();
  await page.keyboard.type('Zhuk');
  await page.reload({ waitUntil: 'networkidle' });
  const s = await store();
  return s.ss[ANDERER]?.lektuere?.text === 'Zhuk' ? true : JSON.stringify(s.ss[ANDERER]);
});

await check('Seitenwechsel direkt nach dem Tippen verliert nichts', async () => {
  // Nach dem Neuladen steht wieder „heute" — der andere Tag ist in der Woche.
  await page.locator('[data-ssview="week"]').click();
  await page.waitForTimeout(300);
  await text(ANDERER, 'lektuere').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 5.2');
  await page.evaluate(() => { location.hash = 'kalender'; });
  await page.waitForTimeout(50);
  const s = await store();
  // Der Speicher schreibt selbst entprellt (250 ms); im Zustand muss der
  // Text sofort stehen, im Speicher spaetestens danach.
  await page.waitForTimeout(350);
  const s2 = await store();
  return (s2.ss[ANDERER]?.lektuere?.text === 'Zhuk 5.2') ? true : JSON.stringify(s2.ss[ANDERER] || s.ss);
});

console.log('\nFunktionsprüfungen (SS):');
for (const [n, r] of checks) console.log(`  ${r === 'ok' ? 'ok ' : '‼  '} ${n}${r === 'ok' ? '' : ' — ' + r}`);
if (errors.length) { errors.forEach((e) => console.log('  ‼ ' + e)); process.exitCode = 1; }
if (checks.some(([, r]) => r !== 'ok')) process.exitCode = 1;
await browser.close();
