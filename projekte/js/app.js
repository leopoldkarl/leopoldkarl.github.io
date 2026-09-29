// app.js — Controller: Router, Ereignisse, Dialoge, Abgleich.

import {
  STATUS_LABEL, COLORS, WEIGHTS, newProject, newMilestone, newTask, parseDateInput,
  formatDate, todayIso, normalizeState, milestoneComplete,
  parseTagInput, allTags, cleanTag,
} from './model.js';
import { Store, findProject, findMilestone, findTask, touch } from './store.js';
import {
  renderOverview, renderDetail, renderTimeline, statusOptions, colorSwatches, SORTS, FILTERS,
} from './views.js';
import {
  SyncClient, establishKey, loadConfig, saveConfig, conflictCopies, kalenderConfig, CONFLICT_PREFIX,
} from './sync.js';
import { loadKey, saveKey, clearKey } from './keystore.js';

const $ = (sel, root = document) => root.querySelector(sel);

const store = new Store();
let sync = null;
let keyCache = null;

/* ------------------------------------------------------------------ */
/* Ansichtszustand (je Gerät, nicht im Datenblock)                     */
/* ------------------------------------------------------------------ */

const UI_KEY = 'projekte.ui';
const ui = { filter: 'laufend', sort: 'status', hideDone: false, theme: 'auto', tags: [] };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY)) || {}); } catch { /* egal */ }
if (!FILTERS.some((f) => f.id === ui.filter)) ui.filter = 'laufend';
if (!SORTS.some((f) => f.id === ui.sort)) ui.sort = 'status';
ui.tags = Array.isArray(ui.tags) ? ui.tags.map(cleanTag).filter(Boolean) : [];
const saveUi = () => { try { const { chartW, ...keep } = ui; localStorage.setItem(UI_KEY, JSON.stringify(keep)); } catch { /* egal */ } };

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
  let m;
  if ((m = /^\/p\/([^/]+)$/.exec(h))) return { view: 'detail', id: decodeURIComponent(m[1]) };
  if (h === '/zeitleiste') return { view: 'zeitleiste' };
  return { view: 'uebersicht' };
}

let lastRouteKey = '';

function render() {
  const r = route();
  const main = $('#main');

  // Fokus und Auswahl über das Neuzeichnen retten (data-fk).
  const ae = document.activeElement;
  const fk = ae && main.contains(ae) ? ae.dataset.fk : null;
  const sel = fk && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const scroll = window.scrollY;

  // Diagrammbreite = Innenbreite der Karte (main minus Innenabstände).
  ui.chartW = Math.max(300, main.clientWidth - parseFloat(getComputedStyle(main).paddingLeft) * 2 - 14);

  let html;
  let title = 'Projekte';
  if (r.view === 'detail') {
    const p = findProject(store.state, r.id);
    if (!p) {
      html = '<p class="muted empty-small">Dieses Projekt gibt es nicht (mehr). <a href="#/">Zur Übersicht</a></p>';
    } else {
      html = renderDetail(p, ui);
      title = `${p.title} · Projekte`;
    }
  } else if (r.view === 'zeitleiste') {
    html = renderTimeline(store.state, ui);
    title = 'Zeitleiste · Projekte';
  } else {
    html = renderOverview(store.state, ui);
  }
  main.innerHTML = html;
  document.title = title;

  for (const a of document.querySelectorAll('.topbar [data-view]')) {
    const on = a.dataset.view === r.view;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }

  const key = JSON.stringify(r);
  if (key !== lastRouteKey) { lastRouteKey = key; window.scrollTo(0, 0); }
  else window.scrollTo(0, scroll);

  if (fk) {
    const el = main.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* egal */ } }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Änderungen                                                          */
/* ------------------------------------------------------------------ */

const currentProjectId = () => { const r = route(); return r.view === 'detail' ? r.id : null; };

/** Änderung an einem Projekt; `norender` für reine Texteingaben (Fokus bleibt). */
function change(pid, fn, label, { norender = false } = {}) {
  store.commit((s) => {
    const p = findProject(s, pid);
    if (!p) return;
    fn(p, s);
    touch(p);
  }, label, { norender });
}

function setTaskDone(t, done) {
  t.done = done;
  t.doneAt = done ? todayIso() : null;
}

function onMainClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const pid = currentProjectId();
  const msEl = btn.closest('[data-mid]');
  const mid = msEl ? msEl.dataset.mid : null;
  const tEl = btn.closest('[data-tid]');
  const tid = tEl ? tEl.dataset.tid : null;

  switch (act) {
    case 'filter': ui.filter = btn.dataset.id; saveUi(); render(); break;
    case 'tag': {
      const t = btn.dataset.tag;
      const k = t.toLocaleLowerCase('de');
      if (route().view === 'detail') {
        // Aus dem Projekt heraus: Übersicht mit genau diesem Tag.
        ui.tags = [t];
        saveUi();
        location.hash = '#/';
      } else {
        const on = ui.tags.some((x) => x.toLocaleLowerCase('de') === k);
        ui.tags = on ? ui.tags.filter((x) => x.toLocaleLowerCase('de') !== k) : [...ui.tags, t];
        saveUi();
        render();
      }
      break;
    }
    case 'tags-reset': ui.tags = []; saveUi(); render(); break;
    case 'new-project': openProjectDialog(null); break;
    case 'edit-project': openProjectDialog(pid); break;
    case 'new-milestone': openMilestoneDialog(pid, null); break;
    case 'edit-ms': openMilestoneDialog(pid, mid); break;
    case 'toggle-done': ui.hideDone = !ui.hideDone; saveUi(); render(); break;
    case 'toggle-ms':
      change(pid, (p) => {
        const m = p.milestones.find((x) => x.id === mid);
        if (m) { m.done = btn.checked; m.doneAt = btn.checked ? todayIso() : null; }
      }, btn.checked ? 'Meilenstein erledigt' : 'Meilenstein wieder offen');
      break;
    case 'toggle-task':
      change(pid, (p) => {
        const m = p.milestones.find((x) => x.id === mid);
        const t = m && m.tasks.find((x) => x.id === tid);
        if (t) setTaskDone(t, btn.checked);
      }, btn.checked ? 'Aufgabe erledigt' : 'Aufgabe wieder offen');
      break;
    case 'weight':
      change(pid, (p) => {
        const t = findTask({ projects: [p] }, pid, mid, tid);
        if (t) t.weight = WEIGHTS[(WEIGHTS.indexOf(t.weight) + 1) % WEIGHTS.length];
      }, 'Gewicht');
      break;
    case 'del-task': {
      let title = '';
      change(pid, (p) => {
        const m = p.milestones.find((x) => x.id === mid);
        if (!m) return;
        const i = m.tasks.findIndex((x) => x.id === tid);
        if (i >= 0) { title = m.tasks[i].title; m.tasks.splice(i, 1); }
      }, 'Aufgabe gelöscht');
      toast(`„${title || 'Aufgabe'}“ gelöscht — Strg+Z holt sie zurück.`);
      break;
    }
    case 'ms-up':
    case 'ms-down':
      change(pid, (p) => {
        const i = p.milestones.findIndex((x) => x.id === mid);
        const j = act === 'ms-up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= p.milestones.length) return;
        [p.milestones[i], p.milestones[j]] = [p.milestones[j], p.milestones[i]];
      }, 'Reihenfolge');
      break;
    default: break;
  }
}

let notesTimer = null;

function onMainChange(e) {
  const el = e.target;
  const act = el.dataset && el.dataset.act;
  const pid = currentProjectId();
  if (act === 'sort') { ui.sort = el.value; saveUi(); render(); return; }
  if (act === 'notes') {
    clearTimeout(notesTimer);
    const p = findProject(store.state, pid);
    if (p && p.notes !== el.value) {
      const v = el.value;
      change(pid, (x) => { x.notes = v; }, 'Notizen', { norender: true });
    }
    return;
  }
  if (act === 'task-title') {
    const mid = el.closest('[data-mid]').dataset.mid;
    const tid = el.closest('[data-tid]').dataset.tid;
    const v = el.value.trim();
    const t = findTask(store.state, pid, mid, tid);
    if (!t || t.title === v) return;
    change(pid, (p) => { const x = findTask({ projects: [p] }, pid, mid, tid); if (x) x.title = v; }, 'Aufgabe umbenannt', { norender: true });
  }
}

function onMainInput(e) {
  const el = e.target;
  if (el.dataset.act !== 'notes') return;
  const pid = currentProjectId();
  clearTimeout(notesTimer);
  // Entprellt, und ein Undo-Schritt je Pause statt je Tastendruck.
  notesTimer = setTimeout(() => {
    const p = findProject(store.state, pid);
    if (!p || p.notes === el.value) return;
    const v = el.value;
    change(pid, (x) => { x.notes = v; }, 'Notizen', { norender: true });
  }, 500);
}

function onMainKeydown(e) {
  const el = e.target;
  if (el.dataset.act === 'new-task' && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const v = el.value.trim();
    if (!v) return;
    const pid = currentProjectId();
    const mid = el.closest('[data-mid]').dataset.mid;
    change(pid, (p) => {
      const m = p.milestones.find((x) => x.id === mid);
      if (!m) return;
      // Ein bereits abgehakter Meilenstein ohne Aufgaben: sein Haken wird zur
      // ersten, erledigten Aufgabe? Nein — das wäre geraten. Er gilt ab jetzt
      // über seine Aufgaben, der alte Haken ist bedeutungslos.
      m.tasks.push(newTask({ title: v }));
    }, 'Aufgabe angelegt');
    // Fokus bleibt im Eingabefeld (data-fk), der Wert ist nach dem Neuzeichnen leer.
    return;
  }
  if (el.dataset.act === 'task-title') {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') {
      const t = findTask(store.state, currentProjectId(), el.closest('[data-mid]').dataset.mid, el.closest('[data-tid]').dataset.tid);
      if (t) el.value = t.title;
      el.blur();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Projekt-Dialog                                                      */
/* ------------------------------------------------------------------ */

let editingProject = null;   // id oder null (neu)
let pdColor = COLORS[0];
let deleteArmed = false;

function setSwatches(color) {
  pdColor = color;
  $('#pd-colors').innerHTML = colorSwatches(color);
}

function openProjectDialog(pid) {
  const p = pid ? findProject(store.state, pid) : null;
  editingProject = p ? p.id : null;
  $('#pd-title').textContent = p ? 'Projekt bearbeiten' : 'Neues Projekt';
  $('#pd-name').value = p ? p.title : '';
  $('#pd-desc').value = p ? p.description : '';
  $('#pd-tags').value = p ? p.tags.join(', ') : ui.tags.join(', ');
  renderTagSuggestions();
  $('#pd-start').value = p ? formatDate(p.start) : formatDate(todayIso());
  $('#pd-due').value = p ? formatDate(p.due) : '';
  $('#pd-status').innerHTML = statusOptions(p ? p.status : 'aktiv');
  const used = new Set(store.state.projects.map((x) => x.color));
  setSwatches(p ? p.color : (COLORS.find((c) => !used.has(c)) || COLORS[store.state.projects.length % COLORS.length]));
  $('#pd-msg').textContent = '';
  $('#pd-delete').hidden = !p;
  $('#pd-delete').textContent = 'Löschen';
  deleteArmed = false;
  $('#project-dialog').showModal();
  $('#pd-name').focus();
}

/** Vorhandene Tags zum Anklicken unter dem Eingabefeld; bereits gesetzte ausgeblendet. */
function renderTagSuggestions() {
  const have = new Set(parseTagInput($('#pd-tags').value).map((t) => t.toLocaleLowerCase('de')));
  const rest = allTags(store.state.projects).filter(({ tag }) => !have.has(tag.toLocaleLowerCase('de')));
  const box = $('#pd-tag-suggest');
  box.hidden = !rest.length;
  box.innerHTML = rest.length
    ? `<span class="muted">Vorhanden:</span> ${rest.map(({ tag }) => `<button type="button" class="tag" data-tag="${tag.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}">#${tag.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</button>`).join('')}`
    : '';
}

function addSuggestedTag(tag) {
  const cur = parseTagInput($('#pd-tags').value);
  $('#pd-tags').value = [...cur, tag].join(', ');
  renderTagSuggestions();
  $('#pd-tags').focus();
}

function saveProjectDialog() {
  const title = $('#pd-name').value.trim();
  const start = parseDateInput($('#pd-start').value);
  const due = parseDateInput($('#pd-due').value);
  const msg = $('#pd-msg');
  $('#pd-start').classList.toggle('bad', start === null);
  $('#pd-due').classList.toggle('bad', due === null);
  if (!title) { msg.textContent = 'Titel fehlt.'; return false; }
  if (start === null || due === null) { msg.textContent = 'Datum nicht lesbar.'; return false; }
  if (start && due && due < start) { msg.textContent = 'Das Ziel liegt vor dem Beginn.'; return false; }
  const fields = {
    title, description: $('#pd-desc').value.trim(), start: start || null, due: due || null,
    status: $('#pd-status').value, color: pdColor,
    tags: parseTagInput($('#pd-tags').value),
  };
  if (editingProject) {
    change(editingProject, (p) => Object.assign(p, fields), 'Projekt geändert');
  } else {
    const p = newProject(fields);
    store.commit((s) => { s.projects.push(p); }, 'Projekt angelegt');
    location.hash = `#/p/${p.id}`;
  }
  return true;
}

function deleteProjectFromDialog() {
  if (!deleteArmed) {
    deleteArmed = true;
    $('#pd-delete').textContent = 'Wirklich löschen?';
    return;
  }
  const id = editingProject;
  const p = findProject(store.state, id);
  store.commit((s) => { s.projects = s.projects.filter((x) => x.id !== id); }, 'Projekt gelöscht');
  $('#project-dialog').close();
  location.hash = '#/';
  toast(`„${p ? p.title : 'Projekt'}“ gelöscht — Strg+Z holt es zurück.`);
}

/* ------------------------------------------------------------------ */
/* Meilenstein-Dialog                                                  */
/* ------------------------------------------------------------------ */

let editingMs = null;   // { pid, mid|null }
let msDeleteArmed = false;

function openMilestoneDialog(pid, mid) {
  const m = mid ? findMilestone(store.state, pid, mid) : null;
  editingMs = { pid, mid: m ? m.id : null };
  $('#md-title').textContent = m ? 'Meilenstein bearbeiten' : 'Neuer Meilenstein';
  $('#md-name').value = m ? m.title : '';
  $('#md-due').value = m ? formatDate(m.due) : '';
  $('#md-msg').textContent = '';
  $('#md-due').classList.remove('bad');
  $('#md-delete').hidden = !m;
  $('#md-delete').textContent = 'Löschen';
  msDeleteArmed = false;
  $('#milestone-dialog').showModal();
  $('#md-name').focus();
}

function saveMilestoneDialog() {
  const title = $('#md-name').value.trim();
  const due = parseDateInput($('#md-due').value);
  $('#md-due').classList.toggle('bad', due === null);
  if (!title) { $('#md-msg').textContent = 'Titel fehlt.'; return false; }
  if (due === null) { $('#md-msg').textContent = 'Datum nicht lesbar.'; return false; }
  const { pid, mid } = editingMs;
  if (mid) {
    change(pid, (p) => {
      const m = p.milestones.find((x) => x.id === mid);
      if (m) { m.title = title; m.due = due || null; }
    }, 'Meilenstein geändert');
  } else {
    const m = newMilestone({ title, due: due || null });
    change(pid, (p) => { p.milestones.push(m); }, 'Meilenstein angelegt');
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-fk="new-${CSS.escape(m.id)}"]`);
      if (el) el.focus();
    });
  }
  return true;
}

function deleteMilestoneFromDialog() {
  const { pid, mid } = editingMs;
  const m = findMilestone(store.state, pid, mid);
  if (!msDeleteArmed && m && m.tasks.length) {
    msDeleteArmed = true;
    $('#md-delete').textContent = `Mit ${m.tasks.length} Aufgabe${m.tasks.length === 1 ? '' : 'n'} löschen?`;
    return;
  }
  change(pid, (p) => { p.milestones = p.milestones.filter((x) => x.id !== mid); }, 'Meilenstein gelöscht');
  $('#milestone-dialog').close();
  toast('Meilenstein gelöscht — Strg+Z holt ihn zurück.');
}

/* ------------------------------------------------------------------ */
/* Export / Import                                                     */
/* ------------------------------------------------------------------ */

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  download(`projekte-${todayIso()}.json`, JSON.stringify({ ...store.state, exported: new Date().toISOString() }, null, 2));
}

async function importJson(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Keine lesbare JSON-Datei.'); return; }
  if (!data || !Array.isArray(data.projects)) { toast('Die Datei enthält keine Projektliste.'); return; }
  const n = normalizeState(data).projects.length;
  store.replace(data, 'Import');
  toast(`${n} Projekt${n === 1 ? '' : 'e'} eingespielt — der bisherige Stand ist ersetzt; Strg+Z macht es rückgängig.`);
}

/* ------------------------------------------------------------------ */
/* Abgleich                                                            */
/* ------------------------------------------------------------------ */

const SYNC_BADGE = {
  aus: { zeichen: '○', text: 'Abgleich: aus' },
  gesperrt: { zeichen: '🔒', text: 'Abgleich: Passphrase fehlt auf diesem Gerät' },
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
}

async function currentKey() {
  if (keyCache) return keyCache;
  keyCache = await loadKey();
  return keyCache;
}

function buildSync() {
  sync = new SyncClient({
    store,
    getKey: currentKey,
    onRemoteState: (state) => store.adoptExternal(state),
    onStatus: renderSyncBadge,
  });
  return sync;
}

async function startSync() {
  buildSync();
  if (!sync.enabled) { renderSyncBadge({ state: 'aus' }); return; }
  const key = await currentKey();
  if (!key) { renderSyncBadge({ state: 'gesperrt' }); return; }
  sync.start();
}

function syncMsg(text, ok = false) {
  const el = $('#sync-msg');
  el.textContent = text || '';
  el.classList.toggle('good', !!ok);
}

function openSyncDialog() {
  const cfg = loadConfig();
  const fromK = !cfg ? kalenderConfig() : null;
  const use = cfg || fromK;
  $('#sync-url').value = use ? use.url : '';
  $('#sync-token').value = use ? use.token : '';
  $('#sync-from-kalender').hidden = !fromK;
  $('#sync-pass').value = '';
  $('#sync-pass2').value = '';
  syncMsg(cfg ? 'Eingerichtet. Passphrase nur nötig, um dieses Gerät zu entsperren.' : '');
  $('#sync-off').hidden = !cfg;
  const liste = conflictCopies();
  $('#sync-conflicts').textContent = liste.length
    ? `${liste.length} Sicherung(en): ${liste.map((k) => k.replace(CONFLICT_PREFIX, '')).join(', ')} — liegen im localStorage dieses Browsers.`
    : 'keine';
  $('#sync-dialog').showModal();
}

async function saveSyncDialog() {
  const url = $('#sync-url').value.trim();
  const token = $('#sync-token').value.trim();
  const pass = $('#sync-pass').value;
  const pass2 = $('#sync-pass2').value;
  const vorhanden = await currentKey();

  if (!/^https?:\/\/\S+$/.test(url) || (!url.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))) {
    syncMsg('Die Adresse muss mit https:// beginnen.'); return;
  }
  if (!token) { syncMsg('Ohne Token geht nichts.'); return; }
  if (!pass && !vorhanden) { syncMsg('Passphrase fehlt.'); return; }
  if (pass && pass !== pass2) { syncMsg('Die beiden Passphrasen sind nicht gleich.'); return; }
  if (pass && pass.length < 12) { syncMsg('Bitte mindestens zwölf Zeichen — besser vier zufällige Wörter.'); return; }

  const config = { url, token };
  syncMsg('Verbinde…');
  try {
    if (pass) {
      const r = await establishKey(config, pass);
      await saveKey(r.key, r.salt, r.iterations);
      keyCache = { key: r.key, salt: r.salt, iterations: r.iterations };
      saveConfig(config);
      if (!sync) buildSync();
      // Reihenfolge ist wichtig: erst Basisversion und Serverstand setzen, dann
      // starten. Umgekehrt lädt der Start (Server leer) schon hoch, und ein
      // nachträgliches setVersion(0) erzeugte beim nächsten Schreiben einen
      // Schein-Konflikt.
      sync.stop();
      sync.setVersion(r.version, null);
      if (r.remoteState) store.adoptExternal(r.remoteState);
      sync.reconfigure(config);
      await sync.pull();   // Server leer: lädt hoch; sonst nur Blick auf /version
      syncMsg(r.remoteState
        ? `Verbunden. Stand vom Server übernommen (Version ${r.version}).`
        : 'Verbunden. Der Server war leer und hat jetzt deinen Stand.', true);
    } else {
      saveConfig(config);
      if (!sync) buildSync();
      sync.reconfigure(config);
    }
    $('#sync-dialog').close();
    toast('Abgleich eingerichtet.');
  } catch (err) {
    syncMsg(String(err && err.message ? err.message : err));
  }
}

async function turnSyncOff() {
  if (sync) sync.reconfigure(null);
  saveConfig(null);
  try { await clearKey(); } catch { /* egal */ }
  keyCache = null;
  renderSyncBadge({ state: 'aus' });
  $('#sync-dialog').close();
  toast('Abgleich ausgeschaltet. Die Daten bleiben lokal erhalten.');
}

/* ------------------------------------------------------------------ */
/* Kleinkram                                                           */
/* ------------------------------------------------------------------ */

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function toggleMenu(open) {
  const m = $('#menu');
  const on = open ?? m.hidden;
  m.hidden = !on;
  $('#btn-menu').setAttribute('aria-expanded', String(on));
}

function isTyping(el) {
  return el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

function init() {
  store.load();
  if (!store.storageOk) $('#storage-warning').hidden = false;
  applyTheme();

  store.subscribe((_s, meta) => {
    if (meta && meta.norender) return;
    render();
  });
  store.watchOtherWindows();

  window.addEventListener('hashchange', render);
  let resizeTimer = null;
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(window.innerWidth - lastW) < 40 || route().view !== 'detail') return;
      if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
      lastW = window.innerWidth;
      render();
    }, 200);
  });

  const main = $('#main');
  main.addEventListener('click', onMainClick);
  main.addEventListener('change', onMainChange);
  main.addEventListener('input', onMainInput);
  main.addEventListener('keydown', onMainKeydown);

  $('#btn-new').addEventListener('click', () => openProjectDialog(null));
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
    else if (act === 'theme') {
      ui.theme = { auto: 'light', light: 'dark', dark: 'auto' }[ui.theme] || 'auto';
      saveUi(); applyTheme();
    }
  });
  $('#import-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJson(f);
    e.target.value = '';
  });

  $('#project-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (saveProjectDialog()) $('#project-dialog').close();
  });
  $('#pd-cancel').addEventListener('click', () => $('#project-dialog').close());
  $('#pd-tags').addEventListener('input', renderTagSuggestions);
  $('#pd-tags').addEventListener('blur', () => {
    const v = parseTagInput($('#pd-tags').value);
    $('#pd-tags').value = v.join(', ');
  });
  $('#pd-tag-suggest').addEventListener('mousedown', (e) => {
    // mousedown statt click: sonst normalisiert der blur des Eingabefelds zuerst.
    const b = e.target.closest('[data-tag]');
    if (b) { e.preventDefault(); addSuggestedTag(b.dataset.tag); }
  });
  $('#pd-tag-suggest').addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-tag]');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addSuggestedTag(b.dataset.tag); }
  });
  $('#pd-delete').addEventListener('click', deleteProjectFromDialog);
  $('#pd-colors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (b) setSwatches(b.dataset.color);
  });
  for (const id of ['#pd-start', '#pd-due', '#md-due']) {
    $(id).addEventListener('blur', (e) => {
      const v = parseDateInput(e.target.value);
      e.target.classList.toggle('bad', v === null);
      if (v) e.target.value = formatDate(v);
    });
  }

  $('#milestone-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (saveMilestoneDialog()) $('#milestone-dialog').close();
  });
  $('#md-cancel').addEventListener('click', () => $('#milestone-dialog').close());
  $('#md-delete').addEventListener('click', deleteMilestoneFromDialog);

  $('#btn-sync-badge').addEventListener('click', openSyncDialog);
  $('#sync-save').addEventListener('click', () => { saveSyncDialog(); });
  $('#sync-cancel').addEventListener('click', () => $('#sync-dialog').close());
  $('#sync-off').addEventListener('click', () => { turnSyncOff(); });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
      e.preventDefault();
      const what = store.undo();
      toast(what ? `Rückgängig: ${what}` : 'Nichts mehr rückgängig zu machen.');
      return;
    }
    if (mod || e.altKey || isTyping(e.target)) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openProjectDialog(null); }
    else if (e.key === 'Escape' && route().view === 'detail') location.hash = '#/';
  });

  render();
  startSync();

  // Für Tests und die Konsole; kein Teil der Oberfläche.
  window.__projekte = { store, get sync() { return sync; }, STATUS_LABEL, milestoneComplete };
}

init();
