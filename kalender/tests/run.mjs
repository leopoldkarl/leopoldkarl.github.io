// run.mjs — alle Prüfungen: Einheitentests direkt, Browsertests gegen einen
// statischen Server auf der Repo-Wurzel (siehe README).
//
//   node tests/run.mjs          alles
//   node tests/run.mjs unit     nur ohne Browser

import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..');      // Repo-Wurzel, nicht kalender/
const PORT = 8765;
const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

function server() {
  const s = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = path.normalize(path.join(REPO, decodeURIComponent(url.pathname)));
      if (!p.startsWith(REPO)) { res.writeHead(403).end(); return; }
      if ((await stat(p).catch(() => null))?.isDirectory()) p = path.join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPEN[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end('nicht gefunden'); }
  });
  return new Promise((ok, fail) => { s.once('error', fail); s.listen(PORT, '127.0.0.1', () => ok(s)); });
}

function lauf(datei, env = {}) {
  return new Promise((ok) => {
    const k = spawn(process.execPath, [datei], { stdio: 'inherit', env: { ...process.env, ...env } });
    k.on('exit', (code) => ok(code === 0));
  });
}

const liste = async (dir) => (await readdir(path.join(HIER, dir)).catch(() => []))
  .filter((f) => f.endsWith('.mjs')).sort().map((f) => path.join(HIER, dir, f));

const nurUnit = process.argv[2] === 'unit';
const ergebnisse = [];
for (const f of await liste('unit')) ergebnisse.push([path.relative(HIER, f), await lauf(f)]);

if (!nurUnit) {
  const s = await server();
  try {
    for (const f of await liste('browser')) {
      ergebnisse.push([path.relative(HIER, f), await lauf(f, { KALENDER_URL: `http://127.0.0.1:${PORT}/kalender/index.html` })]);
    }
  } finally { s.close(); }
}

console.log('\nZusammenfassung:');
for (const [n, ok] of ergebnisse) console.log(`  ${ok ? 'ok ' : '‼  '} ${n}`);
process.exitCode = ergebnisse.every(([, ok]) => ok) ? 0 : 1;
