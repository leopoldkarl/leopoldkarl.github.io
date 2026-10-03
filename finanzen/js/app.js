// app.js — Controller: Sperre, Router, Dialoge, Abgleich.

import {
  emptyState, normalizeState, newId, nextSeq, freeSlot, todayIso, parseDateInput, formatDate,
  parseAmount, plain, parseRate, ledger, balancesAt, rateAt, titleSuggestions, CURRENCIES,
  newPublishedRates,
} from './model.js';
import { Store, findAccount, findEntry } from './store.js';
import {
  renderOverview, renderJournal, renderAnalysis, renderAccounts, attachChartHover,
  accountOptions, kindOptions, standRows, esc, PAGE,
} from './views.js';
import {
  SyncClient, establishKey, loadConfig, saveConfig, conflictCopies, foreignConfig,
  keepConflictCopy, CONFLICT_PREFIX,
} from './sync.js';
import {
  readVault, readVaultRaw, newKey, unlockBlob, rememberKey, recallKey, forgetKey, sameSalt,
  openBlob, nfc, MIN_PASSPHRASE,
} from './vault.js';

const $ = (sel, root = document) => root.querySelector(sel);

const store = new Store();
let sync = null;
let led = ledger(store.state);

/* ------------------------------------------------------------------ */
/* Ansichtszustand je Gerät (kein Finanzinhalt!)                       */
/* ------------------------------------------------------------------ */

const UI_KEY = 'finanzen.ui';
const ui = { theme: 'auto', journalLimit: PAGE };
try { const u = JSON.parse(localStorage.getItem(UI_KEY)); if (u && u.theme) ui.theme = u.theme; } catch { /* egal */ }
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ theme: ui.theme })); } catch { /* egal */ } };

function applyTheme() {
  if (ui.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = ui.theme;
  $('#theme-label').textContent = { auto: 'automatisch', light: 'hell', dark: 'dunkel' }[ui.theme];
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = { '/buchungen': 'buchungen', '/auswertung': 'auswertung', '/konten': 'konten' }[path] || 'uebersicht';
  return { view, q };
}

function setQuery(patch) {
  const r = route();
  const q = { ...r.q, ...patch };
  for (const k of Object.keys(q)) if (!q[k]) delete q[k];
  const qs = new URLSearchParams(q).toString();
  const path = { buchungen: '/buchungen', auswertung: '/auswertung', konten: '/konten' }[r.view] || '/';
  history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
  render();
}

let lastView = '';

function render() {
  if (!store.unlocked) return;
  const r = route();
  const main = $('#main');
  led = ledger(store.state);

  const ae = document.activeElement;
  const fk = ae && main.contains(ae) ? ae.dataset.fk : null;
  const sel = fk && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const scroll = window.scrollY;

  ui.chartW = Math.max(300, main.clientWidth - parseFloat(getComputedStyle(main).paddingLeft) * 2 - 24);

  let html; let title = 'Finanzen';
  if (r.view === 'buchungen') { html = renderJournal(store.state, ui, led, r.q); title = 'Buchungen · Finanzen'; }
  else if (r.view === 'auswertung') { html = renderAnalysis(store.state, ui, led, r.q); title = 'Auswertung · Finanzen'; }
  else if (r.view === 'konten') { html = renderAccounts(store.state, led); title = 'Konten · Finanzen'; }
  else html = renderOverview(store.state, ui, led);
  main.innerHTML = html;
  document.title = title;
  if (r.view === 'uebersicht') attachChartHover(main);

  for (const a of document.querySelectorAll('#nav [data-view]')) {
    if (a.dataset.view === r.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  $('#titles').innerHTML = titleSuggestions(store.state).map((t) => `<option value="${esc(t)}">`).join('');

  if (r.view !== lastView) { lastView = r.view; ui.journalLimit = PAGE; window.scrollTo(0, 0); } else window.scrollTo(0, scroll);
  if (fk) {
    const el = main.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* egal */ } } }
  }
}

/* ------------------------------------------------------------------ */
/* Sperre                                                              */
/* ------------------------------------------------------------------ */

function showLocked(mode) {
  document.body.classList.remove('is-unlocked');
  $('#main').hidden = true; $('#main').innerHTML = '';
  $('#nav').hidden = true; $('#unlocked-tools').hidden = true;
  $('#lock').hidden = false;
  $('#unlock-form').hidden = mode !== 'unlock';
  $('#setup').hidden = mode !== 'setup';
  for (const id of ['#unlock-msg', '#new-msg', '#srv-msg']) msg(id, '');
  if (mode === 'unlock') { $('#unlock-pass').value = ''; $('#unlock-pass').focus(); }
  if (mode === 'setup') {
    const fc = loadConfig() || foreignConfig();
    $('#srv-url').value = fc ? fc.url : '';
    $('#srv-token').value = fc ? fc.token : '';
    $('#srv-from').hidden = !(fc && fc.from);
    $('#srv-from').textContent = fc && fc.from ? `Adresse und Token aus /${fc.from} übernommen.` : '';
    setSetupTab(loadConfig() ? 'server' : 'neu');
  }
  document.title = 'Finanzen';
}

function showUnlocked() {
  document.body.classList.add('is-unlocked');
  $('#lock').hidden = true;
  $('#main').hidden = false; $('#nav').hidden = false; $('#unlocked-tools').hidden = false;
  if (!store.storageOk) $('#storage-warning').hidden = false;
  render();
}

function setSetupTab(which) {
  for (const b of document.querySelectorAll('[data-setup]')) b.setAttribute('aria-pressed', String(b.dataset.setup === which));
  $('#setup-new').hidden = which !== 'neu';
  $('#setup-server').hidden = which !== 'server';
  (which === 'neu' ? $('#new-pass') : ($('#srv-url').value ? $('#srv-pass') : $('#srv-url'))).focus();
}

function msg(id, text, kind = '') {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('good', kind === 'good');
  el.classList.toggle('bad-t', kind === 'bad');
}

async function unlocked(keyObj, state, { remember, write = false }) {
  if (remember) { try { await rememberKey(keyObj); } catch { /* ohne Merken weiter */ } }
  store.open(keyObj, state, { write });
  showUnlocked();
  startSync();
}

async function onUnlockSubmit(e) {
  e.preventDefault();
  const blob = readVault();
  if (!blob) { showLocked('setup'); return; }
  $('#unlock-go').disabled = true;
  msg('#unlock-msg', 'Prüfe …');
  try {
    const { keyObj, state } = await unlockBlob($('#unlock-pass').value, blob);
    msg('#unlock-msg', '');
    await unlocked(keyObj, state, { remember: $('#unlock-remember').checked });
  } catch {
    msg('#unlock-msg', 'Falsche Passphrase.', 'bad');
    $('#unlock-pass').select();
  } finally { $('#unlock-go').disabled = false; }
}

async function onSetupNew(e) {
  e.preventDefault();
  const p = $('#new-pass').value; const p2 = $('#new-pass2').value;
  if (nfc(p).length < MIN_PASSPHRASE) { msg('#new-msg', `Mindestens ${MIN_PASSPHRASE} Zeichen.`, 'bad'); return; }
  if (p !== p2) { msg('#new-msg', 'Die beiden Eingaben sind nicht gleich.', 'bad'); return; }
  if (readVault()) { msg('#new-msg', 'Auf diesem Gerät liegen schon Daten — bitte neu laden.', 'bad'); return; }
  msg('#new-msg', 'Leite Schlüssel ab …');
  const keyObj = await newKey(p);
  msg('#new-msg', '');
  await unlocked(keyObj, emptyState(), { remember: $('#new-remember').checked, write: true });
}

function validUrl(url) {
  return /^https:\/\/\S+$/.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]\S*$/.test(url);
}

async function onSetupServer(e) {
  e.preventDefault();
  const url = $('#srv-url').value.trim(); const token = $('#srv-token').value.trim();
  if (!validUrl(url)) { msg('#srv-msg', 'Die Adresse muss mit https:// beginnen.', 'bad'); return; }
  if (!token) { msg('#srv-msg', 'Token fehlt.', 'bad'); return; }
  const pass = $('#srv-pass').value;
  if (!pass) { msg('#srv-msg', 'Passphrase fehlt.', 'bad'); return; }
  msg('#srv-msg', 'Verbinde …');
  const config = { url, token };
  try {
    const r = await establishKey(config, nfc(pass));
    if (!r.remoteState && nfc(pass).length < MIN_PASSPHRASE) {
      msg('#srv-msg', `Der Server ist leer. Für einen neuen Bestand mindestens ${MIN_PASSPHRASE} Zeichen.`, 'bad'); return;
    }
    const keyObj = { key: r.key, salt: r.salt, iterations: r.iterations };
    saveConfig(config);
    buildSync();
    sync.setVersion(r.version, null);
    await unlocked(keyObj, r.remoteState || emptyState(), { remember: $('#srv-remember').checked, write: true });
    toast(r.remoteState ? `Stand vom Server übernommen (Version ${r.version}).` : 'Server war leer — neuer Bestand angelegt.');
  } catch (err) {
    msg('#srv-msg', String(err && err.message ? err.message : err), 'bad');
  }
}

async function lock() {
  if (sync) sync.stop();
  await store.close();
  await forgetKey();
  showLocked(readVault() ? 'unlock' : 'setup');
  renderSyncBadge({ state: 'aus' });
}

/** Ein anderes Fenster hat mit neuem Schlüssel geschrieben: gemerkten versuchen, sonst sperren. */
async function onForeignKey() {
  const k = await recallKey();
  const blob = readVault();
  if (k && blob && sameSalt(k, blob)) {
    try { const st = await openBlob(k, blob); if (sync) sync.stop(); store.open(k, st); startSync(); render(); return; } catch { /* sperren */ }
  }
  if (sync) sync.stop();
  store.keyObj = null;
  store.state = emptyState();
  showLocked('unlock');
  msg('#unlock-msg', 'In einem anderen Fenster wurde neu verschlüsselt — bitte erneut entsperren.');
}

/* ------------------------------------------------------------------ */
/* Änderungen im Hauptbereich                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_ACCOUNTS = [
  { name: 'Konto AT', currency: 'EUR', kind: 'giro' },
  { name: 'Bundesschatz', currency: 'EUR', kind: 'anlage' },
  { name: 'Konto CH', currency: 'CHF', kind: 'giro' },
  { name: 'Sparkonto CH', currency: 'CHF', kind: 'spar' },
  { name: 'Bargeld', currency: 'EUR', kind: 'bar' },
  { name: 'Flatex', currency: 'EUR', kind: 'depot' },
];

function onMainClick(e) {
  const tr = e.target.closest('tr[data-eid]');
  if (tr && !e.target.closest('a,button')) { openEntryDialog(tr.dataset.eid); return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const aid = btn.closest('[data-aid]')?.dataset.aid;
  switch (act) {
    case 'default-accounts':
      store.commit((s) => {
        DEFAULT_ACCOUNTS.forEach((a, i) => s.accounts.push({ id: newId(), ...a, slot: i, archived: false, order: s.accounts.length }));
      }, 'Konten angelegt');
      toast('Sechs Konten angelegt. Als Nächstes: „+ Eintrag“ → Kontostand.');
      break;
    case 'goto-accounts': location.hash = '#/konten'; break;
    case 'acc-new': openAccountDialog(null); break;
    case 'acc-edit': openAccountDialog(aid); break;
    case 'acc-up': case 'acc-down':
      store.commit((s) => {
        const i = s.accounts.findIndex((a) => a.id === aid);
        const j = act === 'acc-up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= s.accounts.length) return;
        [s.accounts[i], s.accounts[j]] = [s.accounts[j], s.accounts[i]];
        s.accounts.forEach((a, k) => { a.order = k; });
      }, 'Reihenfolge');
      break;
    case 'rate-new': openRateDialog(); break;
    case 'rate-del': {
      const d = btn.closest('[data-date]').dataset.date;
      store.commit((s) => {
        const r = s.rates.find((x) => x.date === d);
        // Ein gelöschter OeNB-Kurs soll beim nächsten Abruf nicht wiederkommen.
        if (r && r.src === 'oenb') s.rateSkips = [...(s.rateSkips || []), d];
        s.rates = s.rates.filter((x) => x.date !== d);
      }, 'Kurs gelöscht');
      toast('Kurs gelöscht — Strg+Z holt ihn zurück.');
      break;
    }
    case 'more': ui.journalLimit += PAGE; render(); break;
    default: break;
  }
}

let searchTimer = null;
function onMainInput(e) {
  if (e.target.dataset.act !== 'f-suche') return;
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => { ui.journalLimit = PAGE; setQuery({ suche: v }); }, 250);
}
function onMainChange(e) {
  const act = e.target.dataset.act;
  if (act === 'f-konto') { ui.journalLimit = PAGE; setQuery({ konto: e.target.value }); }
  if (act === 'f-jahr') { ui.journalLimit = PAGE; setQuery({ jahr: e.target.value }); }
}
function onMainKeydown(e) {
  const tr = e.target.closest && e.target.closest('tr[data-eid]');
  if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openEntryDialog(tr.dataset.eid); }
}

/* ------------------------------------------------------------------ */
/* Eintrag-Dialog                                                      */
/* ------------------------------------------------------------------ */

let ed = null;   // { id|null, type, dir }
let edDeleteArmed = false;

function setEntryType(type) {
  ed.type = type;
  for (const b of document.querySelectorAll('#ed-types [data-type]')) b.setAttribute('aria-pressed', String(b.dataset.type === type));
  const f = $('#entry-form');
  for (const t of ['buchung', 'umbuchung', 'stand']) f.querySelector(`.t-${t}`).hidden = t !== type;
  if (!$('#ed-name').value || ['Umbuchung', 'Kontostand'].includes($('#ed-name').value)) {
    $('#ed-name').value = type === 'umbuchung' ? 'Umbuchung' : type === 'stand' ? 'Kontostand' : '';
  }
  if (type === 'stand') fillStand();
  if (type === 'umbuchung') updateTransferIn();
}

function setDir(dir) {
  ed.dir = dir;
  for (const b of document.querySelectorAll('[data-dir]')) b.setAttribute('aria-pressed', String(Number(b.dataset.dir) === dir));
}

function fillStand(values) {
  const date = parseDateInput($('#ed-date').value) || todayIso();
  ed.standDate = date;
  const st = { ...store.state, entries: store.state.entries.filter((e) => !ed || e.id !== ed.id) };
  const computed = balancesAt(st, date);
  const keep = values || Object.fromEntries([...document.querySelectorAll('#ed-stand input')].filter((i) => i.value).map((i) => [i.dataset.acc, i.value]));
  $('#ed-stand').innerHTML = standRows(store.state, computed, keep);
}

function updateTransferIn() {
  const from = findAccount(store.state, $('#ed-from').value);
  const to = findAccount(store.state, $('#ed-to').value);
  const differ = from && to && from.currency !== to.currency;
  $('#ed-in-wrap').hidden = !differ;
  if (differ) {
    const out = parseAmount($('#ed-out').value);
    const rate = rateAt(store.state.rates, parseDateInput($('#ed-date').value) || todayIso());
    let guess = '';
    if (Number.isFinite(out) && out && rate) guess = plain(from.currency === 'EUR' ? Math.round(out * rate) : Math.round(out / rate));
    $('#ed-in').placeholder = guess ? `≈ ${guess} ${to.currency}` : to.currency;
    $('label[for="ed-in"]').textContent = `Betrag angekommen (${to.currency})`;
  }
  $('label[for="ed-out"]').textContent = from ? `Betrag abgebucht (${from.currency})` : 'Betrag abgebucht';
}

function openEntryDialog(id, preset = {}) {
  if (!store.state.accounts.some((a) => !a.archived)) { toast('Zuerst ein Konto anlegen.'); location.hash = '#/konten'; return; }
  const e = id ? findEntry(store.state, id) : null;
  ed = { id: e ? e.id : null, type: e ? e.type : (preset.type || 'buchung'), dir: -1 };
  edDeleteArmed = false;
  $('#ed-title').textContent = e ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  $('#ed-date').value = formatDate(e ? e.date : todayIso());
  $('#ed-name').value = e ? e.title : '';
  $('#ed-details').value = e ? e.details : '';
  $('#ed-msg').textContent = '';
  $('#ed-delete').hidden = !e; $('#ed-delete').textContent = 'Löschen';
  const q = route().q;
  const defAcc = (q.konto && findAccount(store.state, q.konto)) ? q.konto : (store.state.accounts.find((a) => !a.archived) || {}).id;
  const l0 = e && e.lines[0]; const l1 = e && e.lines[1];
  $('#ed-acc').innerHTML = accountOptions(store.state, e && e.type === 'buchung' ? l0.acc : defAcc);
  $('#ed-amt').value = e && e.type === 'buchung' ? plain(Math.abs(l0.amt)) : '';
  setDir(e && e.type === 'buchung' ? (l0.amt >= 0 ? 1 : -1) : -1);
  const tr = e && e.type === 'umbuchung' ? { from: e.lines.find((l) => l.amt < 0) || l0, to: e.lines.find((l) => l.amt >= 0) || l1 } : null;
  $('#ed-from').innerHTML = accountOptions(store.state, tr ? tr.from.acc : defAcc);
  const second = store.state.accounts.find((a) => !a.archived && a.id !== defAcc);
  $('#ed-to').innerHTML = accountOptions(store.state, tr && tr.to ? tr.to.acc : (second || {}).id);
  $('#ed-out').value = tr ? plain(-tr.from.amt) : '';
  $('#ed-in').value = tr && tr.to && findAccount(store.state, tr.from.acc)?.currency !== findAccount(store.state, tr.to.acc)?.currency ? plain(tr.to.amt) : '';
  $('#ed-stand').innerHTML = '';
  setEntryType(ed.type);
  if (e && e.type === 'stand') fillStand(Object.fromEntries(e.lines.map((l) => [l.acc, plain(l.bal)])));
  $('#entry-dialog').showModal();
  (e ? $('#ed-save') : (ed.type === 'buchung' ? $('#ed-amt') : $('#ed-date'))).focus();
}

function saveEntryDialog() {
  const date = parseDateInput($('#ed-date').value);
  const m = (t) => { $('#ed-msg').textContent = t; return false; };
  $('#ed-date').classList.toggle('bad', !date);
  if (!date) return m('Datum fehlt oder ist nicht lesbar.');
  const title = $('#ed-name').value.trim();
  const details = $('#ed-details').value.trim();
  let lines;
  if (ed.type === 'buchung') {
    const amt = parseAmount($('#ed-amt').value);
    if (amt == null || Number.isNaN(amt) || amt === 0) return m('Betrag fehlt oder ist nicht lesbar.');
    lines = [{ acc: $('#ed-acc').value, amt: ed.dir * Math.abs(amt) }];
    if (!title) return m('Titel fehlt (er dient als Kategorie in der Auswertung).');
  } else if (ed.type === 'umbuchung') {
    const from = $('#ed-from').value; const to = $('#ed-to').value;
    if (from === to) return m('Von und Nach sind dasselbe Konto.');
    const out = parseAmount($('#ed-out').value);
    if (out == null || Number.isNaN(out) || out <= 0) return m('Betrag fehlt oder ist nicht lesbar.');
    let inn = out;
    if (!$('#ed-in-wrap').hidden) {
      inn = parseAmount($('#ed-in').value);
      if (inn == null) {
        const ph = $('#ed-in').placeholder.replace(/^≈\s*/, '').replace(/\s*[A-Z]{3}$/, '');
        inn = parseAmount(ph);
      }
      if (inn == null || Number.isNaN(inn) || inn <= 0) return m('Angekommener Betrag fehlt (anderes Währungskonto, kein Kurs).');
    }
    lines = [{ acc: from, amt: -out }, { acc: to, amt: inn }];
  } else {
    lines = [];
    for (const i of document.querySelectorAll('#ed-stand input')) {
      if (!i.value.trim()) { i.classList.remove('bad'); continue; }
      const v = parseAmount(i.value);
      i.classList.toggle('bad', v == null || Number.isNaN(v));
      if (v == null || Number.isNaN(v)) return m('Ein Kontostand ist nicht lesbar.');
      lines.push({ acc: i.dataset.acc, bal: v });
    }
    if (!lines.length) return m('Mindestens einen Kontostand eintragen.');
  }
  const fields = { date, type: ed.type, title, details, lines };
  if (ed.id) {
    const id = ed.id;
    store.commit((s) => { const e = s.entries.find((x) => x.id === id); if (e) Object.assign(e, fields); }, 'Eintrag geändert');
  } else {
    store.commit((s) => { s.entries.push({ id: newId(), seq: nextSeq(s), ...fields }); }, 'Eintrag angelegt');
  }
  return true;
}

function deleteEntryFromDialog() {
  if (!edDeleteArmed) { edDeleteArmed = true; $('#ed-delete').textContent = 'Wirklich löschen?'; return; }
  const id = ed.id;
  store.commit((s) => { s.entries = s.entries.filter((e) => e.id !== id); }, 'Eintrag gelöscht');
  $('#entry-dialog').close();
  toast('Eintrag gelöscht — Strg+Z holt ihn zurück.');
}

/* ------------------------------------------------------------------ */
/* Konto- und Kursdialog                                               */
/* ------------------------------------------------------------------ */

let editingAcc = null;
let accDeleteArmed = false;

function openAccountDialog(id) {
  const a = id ? findAccount(store.state, id) : null;
  editingAcc = a ? a.id : null;
  accDeleteArmed = false;
  const used = a ? store.state.entries.filter((e) => e.lines.some((l) => l.acc === a.id)).length : 0;
  $('#ad-title').textContent = a ? 'Konto bearbeiten' : 'Neues Konto';
  $('#ad-name').value = a ? a.name : '';
  $('#ad-kind').innerHTML = kindOptions(a ? a.kind : 'giro');
  $('#ad-cur').value = a ? a.currency : 'EUR';
  $('#ad-cur').disabled = used > 0;
  $('#ad-archived').checked = a ? a.archived : false;
  $('#ad-hint').textContent = used ? `${used} Einträge auf diesem Konto — Währung fest, Löschen nicht möglich.` : '';
  $('#ad-delete').hidden = !a || used > 0;
  $('#ad-delete').textContent = 'Löschen';
  $('#ad-msg').textContent = '';
  $('#account-dialog').showModal();
  $('#ad-name').focus();
}

function saveAccountDialog() {
  const name = $('#ad-name').value.trim();
  if (!name) { $('#ad-msg').textContent = 'Name fehlt.'; return false; }
  const fields = { name, kind: $('#ad-kind').value, archived: $('#ad-archived').checked };
  if (!$('#ad-cur').disabled && CURRENCIES.includes($('#ad-cur').value)) fields.currency = $('#ad-cur').value;
  if (editingAcc) {
    const id = editingAcc;
    store.commit((s) => { const a = s.accounts.find((x) => x.id === id); if (a) Object.assign(a, fields); }, 'Konto geändert');
  } else {
    store.commit((s) => { s.accounts.push({ id: newId(), currency: 'EUR', ...fields, slot: freeSlot(s), order: s.accounts.length }); }, 'Konto angelegt');
  }
  return true;
}

function deleteAccountFromDialog() {
  if (!accDeleteArmed) { accDeleteArmed = true; $('#ad-delete').textContent = 'Wirklich löschen?'; return; }
  const id = editingAcc;
  store.commit((s) => { s.accounts = s.accounts.filter((a) => a.id !== id); }, 'Konto gelöscht');
  $('#account-dialog').close();
}

function openRateDialog() {
  $('#rd-date').value = formatDate(todayIso());
  const last = store.state.rates[store.state.rates.length - 1];
  $('#rd-rate').value = '';
  $('#rd-rate').placeholder = last ? String(last.chfPerEur).replace('.', ',') : '0,9364';
  $('#rd-msg').textContent = '';
  $('#rate-dialog').showModal();
  $('#rd-rate').focus();
}

function saveRateDialog() {
  const date = parseDateInput($('#rd-date').value);
  const rate = parseRate($('#rd-rate').value);
  if (!date) { $('#rd-msg').textContent = 'Datum nicht lesbar.'; return false; }
  if (rate == null || Number.isNaN(rate)) { $('#rd-msg').textContent = 'Kurs nicht lesbar (z. B. 0,9364).'; return false; }
  store.commit((s) => { s.rates = s.rates.filter((r) => r.date !== date); s.rates.push({ date, chfPerEur: rate }); }, 'Kurs gespeichert');
  return true;
}

/**
 * EZB-Referenzkurs über frankfurter.dev. Übertragen wird nur das Datum.
 * An Tagen ohne Fixing (Wochenende, Feiertag) liefert der Dienst den letzten
 * Arbeitstag davor; das Datum im Formular wird darauf gesetzt.
 */
async function fetchEcbRate() {
  const date = parseDateInput($('#rd-date').value) || todayIso();
  $('#rd-msg').textContent = '';
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=EUR&symbols=CHF`, { referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!res.ok) throw new Error(`Antwort ${res.status}`);
    const body = await res.json();
    const r = body && body.rates && body.rates.CHF;
    if (!Number.isFinite(r)) throw new Error('kein CHF-Kurs in der Antwort');
    $('#rd-rate').value = String(r).replace('.', ',');
    if (body.date && body.date !== date) {
      $('#rd-date').value = formatDate(body.date);
      $('#rd-msg').textContent = `Kein Fixing am ${formatDate(date)} — Kurs vom ${formatDate(body.date)}.`;
    }
  } catch (err) {
    $('#rd-msg').textContent = `Kurs nicht abrufbar (${err && err.message ? err.message : err}). Bitte von Hand eintragen.`;
  }
}

/* ------------------------------------------------------------------ */
/* Export / Import                                                     */
/* ------------------------------------------------------------------ */

function exportJson() {
  const text = JSON.stringify({ ...store.state, exported: new Date().toISOString() }, null, 1);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `finanzen-${todayIso()}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Export ist UNVERSCHLÜSSELT — nicht in Cloud-Ordnern oder im Repo liegen lassen.');
}

async function importJson(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Keine lesbare JSON-Datei.'); return; }
  if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.entries)) { toast('Die Datei enthält keine Konten und Einträge.'); return; }
  const n = normalizeState(data);
  const had = store.state.entries.length + store.state.accounts.length;
  store.replace(n, 'Import');
  toast(`${n.accounts.length} Konten, ${n.entries.length} Einträge, ${n.rates.length} Kurse eingespielt${had ? ' — bisheriger Stand ersetzt, Strg+Z macht es rückgängig' : ''}.`);
}

/* ------------------------------------------------------------------ */
/* Abgleich                                                            */
/* ------------------------------------------------------------------ */

const SYNC_BADGE = {
  aus: { zeichen: '○', text: 'Abgleich: aus' },
  gesperrt: { zeichen: '🔒', text: 'Abgleich: gesperrt' },
  ok: { zeichen: '●', text: 'Abgleich: aktuell' },
  offline: { zeichen: '◌', text: 'Abgleich: kein Netz — lokal wird weitergearbeitet' },
  konflikt: { zeichen: '⚠', text: 'Abgleich: Konflikt' },
  fehler: { zeichen: '⚠', text: 'Abgleich: Fehler' },
};

function renderSyncBadge({ state, detail, updatedAt } = { state: 'aus' }) {
  const b = $('#btn-sync-badge');
  const info = SYNC_BADGE[state] || SYNC_BADGE.aus;
  b.textContent = info.zeichen;
  b.dataset.state = state;
  const stand = updatedAt ? ` · Stand ${new Date(updatedAt).toLocaleString('de-AT')}` : '';
  b.title = `${info.text}${detail ? ` — ${detail}` : ''}${stand}`;
  b.setAttribute('aria-label', b.title);
  if (state === 'konflikt' && detail) toast(detail);
}

function buildSync() {
  if (sync) sync.stop();
  sync = new SyncClient({
    store,
    getKey: async () => store.keyObj,
    onRemoteState: (state) => store.adoptExternal(state),
    onStatus: renderSyncBadge,
  });
  return sync;
}

function startSync() {
  buildSync();
  if (!sync.enabled) { renderSyncBadge({ state: 'aus' }); adoptPublishedRates(); return; }
  sync.start();
  // Erst den Serverstand abwarten, dann Kurse ergänzen — sonst schreiben zwei
  // Geräte dieselben Kurse gleichzeitig und erzeugen einen Schein-Konflikt.
  Promise.resolve(sync._busy).catch(() => {}).finally(() => adoptPublishedRates());
}

/* ------------------------------------------------------------------ */
/* Wöchentliche OeNB-Kurse (öffentlich, aus kurse.json)                */
/* ------------------------------------------------------------------ */

// kurse.json schreibt die GitHub-Action .github/workflows/wechselkurs.yml
// (Referenzkurs der EZB EUR-CHF aus dem OeNB-Webservice, einmal je Woche).
// Doppelt abgefragt: die Pages-Kopie und raw.githubusercontent.com, falls
// GitHub Pages nach dem Commit der Action (noch) nicht neu gebaut hat.
const KURS_QUELLEN = [
  './kurse.json',
  'https://raw.githubusercontent.com/leopoldkarl/leopoldkarl.github.io/main/finanzen/kurse.json',
];
const KURS_ABSTAND = 3600e3;   // höchstens einmal je Stunde nachsehen
let kurseZuletzt = 0;

async function fetchPublishedRates() {
  const all = await Promise.all(KURS_QUELLEN.map(async (u) => {
    try {
      const res = await fetch(u, { cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body && body.rates) ? body.rates : [];
    } catch { return []; }
  }));
  return all.flat();
}

async function adoptPublishedRates({ force = false } = {}) {
  if (!store.unlocked) return 0;
  if (!force && Date.now() - kurseZuletzt < KURS_ABSTAND) return 0;
  kurseZuletzt = Date.now();
  const published = await fetchPublishedRates();
  if (!store.unlocked) return 0;
  const add = newPublishedRates(store.state, published);
  if (!add.length) return 0;
  store.commit((s) => { s.rates.push(...add); }, 'OeNB-Kurse übernommen');
  const last = add[add.length - 1];
  toast(add.length === 1
    ? `OeNB-Kurs vom ${formatDate(last.date)} übernommen: 1 EUR = ${String(last.chfPerEur).replace('.', ',')} CHF.`
    : `${add.length} OeNB-Kurse übernommen (bis ${formatDate(last.date)}).`);
  return add.length;
}

function openSyncDialog() {
  const cfg = loadConfig();
  const fc = !cfg ? foreignConfig() : null;
  const use = cfg || fc;
  $('#sync-url').value = use ? use.url : '';
  $('#sync-token').value = use ? use.token : '';
  $('#sync-from').hidden = !fc;
  $('#sync-from').textContent = fc ? `Adresse und Token aus /${fc.from} übernommen.` : '';
  $('#sync-pass').value = '';
  msg('#sync-msg', cfg ? 'Eingerichtet.' : '');
  $('#sync-off').hidden = !cfg;
  const liste = conflictCopies();
  $('#sync-conflicts').textContent = liste.length
    ? `${liste.length} verschlüsselte Sicherung(en): ${liste.map((k) => k.replace(CONFLICT_PREFIX, '')).join(', ')}`
    : 'keine';
  $('#sync-dialog').showModal();
}

async function saveSyncDialog() {
  const url = $('#sync-url').value.trim();
  const token = $('#sync-token').value.trim();
  const pass = $('#sync-pass').value;
  if (!validUrl(url)) { msg('#sync-msg', 'Die Adresse muss mit https:// beginnen.', 'bad'); return; }
  if (!token) { msg('#sync-msg', 'Token fehlt.', 'bad'); return; }
  const config = { url, token };
  msg('#sync-msg', 'Verbinde …');
  try {
    const r = await establishKey(config, pass ? nfc(pass) : '', undefined, store.keyObj);
    if (sync) sync.stop();
    buildSync();
    // Erst Basisversion setzen, dann starten (sonst Schein-Konflikt, s. /projekte).
    sync.setVersion(r.version, null);
    if (r.remoteState) {
      const local = store.state;
      if (local.entries.length || local.accounts.length) {
        const raw = readVaultRaw();
        if (raw) keepConflictCopy(JSON.parse(raw));
      }
      const keyObj = { key: r.key, salt: r.salt, iterations: r.iterations };
      store.keyObj = keyObj;
      store.adoptExternal(r.remoteState);        // schreibt mit dem Schlüssel des Servers
      if (await recallKey()) { try { await rememberKey(keyObj); } catch { /* egal */ } }
    }
    saveConfig(config);
    sync.reconfigure(config);
    await sync.pull();
    msg('#sync-msg', r.remoteState ? `Verbunden. Stand vom Server übernommen (Version ${r.version}).` : 'Verbunden. Der Server war leer und hat jetzt deinen Stand.', 'good');
    $('#sync-dialog').close();
    toast('Abgleich eingerichtet.');
  } catch (err) {
    msg('#sync-msg', String(err && err.message ? err.message : err), 'bad');
  }
}

function turnSyncOff() {
  if (sync) sync.reconfigure(null);
  saveConfig(null);
  renderSyncBadge({ state: 'aus' });
  $('#sync-dialog').close();
  toast('Abgleich ausgeschaltet. Die Daten bleiben verschlüsselt auf diesem Gerät.');
}

/* ------------------------------------------------------------------ */
/* Kleinkram                                                           */
/* ------------------------------------------------------------------ */

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

function toggleMenu(open) {
  const m = $('#menu');
  const on = open ?? m.hidden;
  m.hidden = !on;
  for (const b of m.querySelectorAll('[data-need="unlocked"]')) b.hidden = !store.unlocked;
  $('#btn-menu').setAttribute('aria-expanded', String(on));
}

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  if (!window.isSecureContext || !globalThis.crypto || !crypto.subtle) {
    $('#lock').hidden = false;
    $('#lock-fatal').hidden = false;
    $('#lock-fatal').textContent = 'WebCrypto nicht verfügbar (nur über HTTPS oder localhost).';
    return;
  }
  const blob = readVault();
  const k = await recallKey();
  if (blob && k && sameSalt(k, blob)) {
    try { const st = await openBlob(k, blob); store.open(k, st); showUnlocked(); startSync(); return; } catch { await forgetKey(); }
  } else if (k && blob) {
    await forgetKey();
  }
  showLocked(blob ? 'unlock' : 'setup');
}

function init() {
  applyTheme();
  store.subscribe((_s, meta) => {
    if (meta && (meta.label === 'lock' || meta.label === 'open')) return;
    render();
  });
  store.watchOtherWindows({ onForeignKey });

  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) adoptPublishedRates(); });
  let resizeTimer = null; let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(window.innerWidth - lastW) < 40 || route().view !== 'uebersicht') return;
      lastW = window.innerWidth; render();
    }, 200);
  });

  const main = $('#main');
  main.addEventListener('click', onMainClick);
  main.addEventListener('input', onMainInput);
  main.addEventListener('change', onMainChange);
  main.addEventListener('keydown', onMainKeydown);

  $('#unlock-form').addEventListener('submit', onUnlockSubmit);
  $('#setup-new').addEventListener('submit', onSetupNew);
  $('#setup-server').addEventListener('submit', onSetupServer);
  for (const b of document.querySelectorAll('[data-setup]')) b.addEventListener('click', () => setSetupTab(b.dataset.setup));

  $('#btn-new').addEventListener('click', () => openEntryDialog(null));
  $('#btn-menu').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) toggleMenu(false); });
  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    toggleMenu(false);
    const act = b.dataset.act;
    if (act === 'sync') openSyncDialog();
    else if (act === 'export') exportJson();
    else if (act === 'import') $('#import-file').click();
    else if (act === 'lock') lock();
    else if (act === 'theme') { ui.theme = { auto: 'light', light: 'dark', dark: 'auto' }[ui.theme] || 'auto'; saveUi(); applyTheme(); }
  });
  $('#import-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJson(f);
    e.target.value = '';
  });

  $('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); if (saveEntryDialog()) $('#entry-dialog').close(); });
  $('#ed-cancel').addEventListener('click', () => $('#entry-dialog').close());
  $('#ed-delete').addEventListener('click', deleteEntryFromDialog);
  for (const b of document.querySelectorAll('#ed-types [data-type]')) b.addEventListener('click', () => setEntryType(b.dataset.type));
  for (const b of document.querySelectorAll('[data-dir]')) b.addEventListener('click', () => setDir(Number(b.dataset.dir)));
  $('#ed-date').addEventListener('blur', (e) => {
    const v = parseDateInput(e.target.value);
    e.target.classList.toggle('bad', v === null);
    if (v) e.target.value = formatDate(v);
    // Nur neu zeichnen, wenn sich das Datum geändert hat: sonst ersetzt der
    // Blur beim Klick in ein Standfeld genau dieses Feld unter dem Zeiger.
    if (ed && ed.type === 'stand' && v && v !== ed.standDate) fillStand();
    if (ed && ed.type === 'umbuchung') updateTransferIn();
  });
  for (const id of ['#ed-from', '#ed-to']) $(id).addEventListener('change', updateTransferIn);
  $('#ed-out').addEventListener('input', updateTransferIn);
  $('#ed-amt').addEventListener('keydown', (e) => {
    // „-“ bzw. „+“ als erstes Zeichen schaltet die Richtung um.
    if ((e.key === '-' || e.key === '+') && !e.target.value) { e.preventDefault(); setDir(e.key === '-' ? -1 : 1); }
  });

  $('#account-form').addEventListener('submit', (e) => { e.preventDefault(); if (saveAccountDialog()) $('#account-dialog').close(); });
  $('#ad-cancel').addEventListener('click', () => $('#account-dialog').close());
  $('#ad-delete').addEventListener('click', deleteAccountFromDialog);

  $('#rate-form').addEventListener('submit', (e) => { e.preventDefault(); if (saveRateDialog()) $('#rate-dialog').close(); });
  $('#rd-cancel').addEventListener('click', () => $('#rate-dialog').close());
  $('#rd-fetch').addEventListener('click', fetchEcbRate);

  $('#btn-sync-badge').addEventListener('click', openSyncDialog);
  $('#sync-save').addEventListener('click', () => { saveSyncDialog(); });
  $('#sync-cancel').addEventListener('click', () => $('#sync-dialog').close());
  $('#sync-off').addEventListener('click', turnSyncOff);

  document.addEventListener('keydown', (e) => {
    if (!store.unlocked || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
      e.preventDefault();
      const what = store.undo();
      toast(what ? `Rückgängig: ${what}` : 'Nichts mehr rückgängig zu machen.');
      return;
    }
    if (mod || e.altKey || isTyping(e.target)) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openEntryDialog(null); }
    else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); openEntryDialog(null, { type: 'stand' }); }
  });

  boot();

  // Für Tests und die Konsole; kein Teil der Oberfläche.
  window.__finanzen = { store, get sync() { return sync; }, lock, adoptPublishedRates };
}

init();
