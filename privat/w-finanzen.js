// w-finanzen.js — aktuelles Gesamtvermögen (EUR, CHF zum jüngsten Kurs bis heute).
//
// Gleiche Rechnung wie die Übersicht in /finanzen (ledger -> totalEur mit
// rateAt(heute)). Quelle: lokales Chiffrat `finanzen.vault` mit dem dort
// gemerkten Schlüssel; ist der Abgleich eingerichtet und der Server weiter,
// dessen Stand. Nur lesend. Ohne gemerkten Schlüssel, direkt nach der
// Passphrase-Eingabe auf /privat, ein Versuch mit derselben Passphrase.

import { readVault, recallKey, sameSalt, unlockBlob, rememberKey } from '/finanzen/js/vault.js';
import { normalizeState, ledger, totalEur, rateAt, todayIso, money } from '/finanzen/js/model.js';
import { loadConfig, SPACE_PATH } from '/finanzen/js/sync.js';
import { decryptState } from '/kalender/js/crypto.js';
import { el, hinweis } from './kachel-util.js';

function lokaleVersion() {
  try { return (JSON.parse(localStorage.getItem('finanzen.syncmeta')) || {}).version || 0; } catch { return 0; }
}

function render(liste, state) {
  const s = normalizeState(state);
  if (!s.accounts.length) { hinweis(liste, 'Noch keine Konten.'); return; }
  const t = totalEur(s, ledger(s).balances, rateAt(s.rates, todayIso()));
  const z = el('div', 'tl-z');
  const a = el('a', 'tl-betrag', money(t.sum));
  a.href = '/finanzen/';
  a.title = 'Gesamtvermögen';
  z.append(a);
  if (t.missing) z.append(el('span', 'tl-m', 'ohne CHF-Konten (kein Kurs)'));
  liste.replaceChildren(z);
}

export async function fuellen(liste, ctx = {}) {
  const blob = readVault();
  let k = await recallKey();
  let state = null;
  if (blob && k && sameSalt(k, blob)) {
    try { state = await decryptState(k.key, blob); } catch { k = null; }
  } else k = null;
  if (!state && blob && ctx.pass) {
    try {
      const r = await unlockBlob(ctx.pass, blob);
      k = r.keyObj; state = r.state;
      if (ctx.merken) await rememberKey(k);
    } catch { /* andere Passphrase */ }
  }
  if (!blob) { hinweis(liste, 'Auf diesem Gerät noch keine Finanzdaten.'); return; }
  if (!state) { hinweis(liste, 'Gesperrt — in /finanzen entsperren.'); return; }
  render(liste, state);

  const cfg = loadConfig();
  if (!cfg) return;
  try {
    const base = `${String(cfg.url).replace(/\/+$/, '')}${SPACE_PATH}`;
    const headers = { Authorization: `Bearer ${cfg.token}` };
    const v = await fetch(`${base}/version`, { headers });
    if (!v.ok) return;
    const head = await v.json();
    if (!head.version || head.version <= lokaleVersion()) return;
    const r = await fetch(`${base}/state`, { headers });
    if (!r.ok) return;
    const body = await r.json();
    if (!body.blob || !sameSalt(k, body.blob)) return;
    render(liste, await decryptState(k.key, body.blob));
  } catch { /* offline: lokaler Stand bleibt */ }
}
