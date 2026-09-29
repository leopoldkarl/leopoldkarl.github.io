// projekte-top.js — die drei dringendsten Projekte in der Kachel „Projekte“.
//
// Datenquelle ist dieselbe wie in /projekte (gleiche Herkunft):
//   1. sofort der lokale Stand aus localStorage `projekte.state`;
//   2. ist der Abgleich auf diesem Geraet eingerichtet und entsperrt, wird
//      danach beim Worker nachgesehen und ein neuerer Stand angezeigt.
// Nur lesend: nichts wird in localStorage oder beim Worker geschrieben, damit
// der Abgleich von /projekte (Versionszaehler, Konfliktregel) unberuehrt bleibt.
//
// Dringlichkeit (Rangfolge, jeweils nur Projekte mit Status „aktiv“, die
// noch nicht fertig sind):
//   Frist = Faelligkeit des naechsten offenen Meilensteins, sonst Projektende.
//   Sortiert nach Frist aufsteigend — Ueberfaelliges steht damit von selbst
//   vorn; bei gleicher Frist der groessere Rueckstand gegenueber dem Soll;
//   Projekte ohne jede Frist zuletzt, untereinander nach Rueckstand.

import {
  normalizeState, summarize, dayNum, fromDayNum, todayIso, formatDate, STATUS_LABEL,
} from '/projekte/js/model.js';
import { STORAGE_KEY } from '/projekte/js/store.js';
import { loadConfig, SPACE_PATH } from '/projekte/js/sync.js';
import { loadKey } from '/projekte/js/keystore.js';
import { decryptState } from '/kalender/js/crypto.js';

const META_KEY = 'projekte.syncmeta';
const N = 3;

function lokal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : null;
  } catch { return null; }
}

function lokaleVersion() {
  try { return (JSON.parse(localStorage.getItem(META_KEY)) || {}).version || 0; }
  catch { return 0; }
}

/** Neuerer Stand vom Worker oder null (nicht eingerichtet, gesperrt, offline, nicht neuer). */
async function entfernt() {
  const config = loadConfig();
  if (!config) return null;
  const key = await loadKey();
  if (!key) return null;
  const base = `${String(config.url).replace(/\/+$/, '')}${SPACE_PATH}`;
  const headers = { Authorization: `Bearer ${config.token}` };
  const v = await fetch(`${base}/version`, { headers });
  if (!v.ok) return null;
  const head = await v.json();
  if (!head.version || head.version <= lokaleVersion()) return null;
  const r = await fetch(`${base}/state`, { headers });
  if (!r.ok) return null;
  const body = await r.json();
  return normalizeState(await decryptState(key.key, body.blob));
}

export function rangfolge(state, today = dayNum(todayIso())) {
  const kand = [];
  state.projects.forEach((p, i) => {
    if (p.status !== 'aktiv') return;
    const s = summarize(p, today);
    if (s.ist === 1) return;
    let frist = s.next ? dayNum(s.next.due) : NaN;
    if (!Number.isFinite(frist)) frist = dayNum(p.due);
    // Projektende schon vorbei, naechster Meilenstein spaeter: das Ende zaehlt.
    if (Number.isFinite(dayNum(p.due)) && dayNum(p.due) < frist) frist = dayNum(p.due);
    kand.push({ p, s, i, frist: Number.isFinite(frist) ? frist : null });
  });
  kand.sort((a, b) => {
    if ((a.frist == null) !== (b.frist == null)) return a.frist == null ? 1 : -1;
    if (a.frist != null && a.frist !== b.frist) return a.frist - b.frist;
    return ((b.s.lagDays ?? -1e9) - (a.s.lagDays ?? -1e9)) || a.i - b.i;
  });
  return kand;
}

function zeile({ p, s, frist }, today) {
  const el = document.createElement('span');
  el.className = 'pz';
  const t = document.createElement('b');
  t.textContent = p.title;
  el.append(t);
  let rest = '';
  if (frist != null) {
    const d = frist - today;
    const datum = formatDate(fromDayNum(frist), { year: false });
    if (d < 0) { rest = ` · überfällig seit ${datum}`; el.classList.add('ueber'); }
    else if (d === 0) rest = ' · heute';
    else if (d === 1) rest = ' · morgen';
    else rest = ` · bis ${datum}`;
  }
  el.append(rest);
  const ms = s.next ? `Nächster Meilenstein: ${s.next.title}` : '';
  el.title = [p.title, ms, STATUS_LABEL[p.status]].filter(Boolean).join(' — ');
  return el;
}

function render(ziel, state) {
  const today = dayNum(todayIso());
  ziel.replaceChildren();
  if (!state) { ziel.textContent = 'Auf diesem Gerät noch keine Projektdaten.'; return; }
  const top = rangfolge(state, today).slice(0, N);
  if (!top.length) { ziel.textContent = 'Keine offenen aktiven Projekte.'; return; }
  for (const k of top) ziel.append(zeile(k, today));
}

export async function fuellen(root) {
  const ziel = root.querySelector('a.tile[href="/projekte/"] span');
  if (!ziel) return;
  ziel.classList.add('projekte-top');
  render(ziel, lokal());
  try {
    const neu = await entfernt();
    if (neu) render(ziel, neu);
  } catch { /* offline oder gesperrt: lokaler Stand bleibt stehen */ }
}
