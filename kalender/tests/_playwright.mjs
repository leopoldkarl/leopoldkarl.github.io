// Playwright liegt je nach Rechner woanders. Der Reihe nach probieren,
// statt einen absoluten Pfad fest einzutragen.
const KANDIDATEN = [
  'playwright',
  '/home/claude/.npm-global/lib/node_modules/playwright/index.js',
  '/usr/lib/node_modules/playwright/index.js',
];

export async function chromium() {
  for (const k of KANDIDATEN) {
    try {
      const m = await import(k);
      return (m.default && m.default.chromium) || m.chromium;
    } catch { /* naechster */ }
  }
  throw new Error('Playwright nicht gefunden. npm i -g playwright');
}
