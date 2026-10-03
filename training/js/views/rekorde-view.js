// Eigene Bestleistungen: Kategorien anlegen, Leistungen eintragen, einzelne
// Einträge löschen, Kategorien leeren oder löschen. Gespeichert im Browser
// (localStorage), optional verschlüsselt über denselben Worker wie Kalender
// und Projekte abgeglichen (Namensraum „training“).

import { h } from '../charts.js';
import * as F from '../format.js';
import * as R from '../rekorde.js';
import { card, table } from '../ui.js';
import {
  SyncClient, establishKey, loadConfig, saveConfig, kalenderConfig, conflictCopies, CONFLICT_PREFIX,
} from '../rekorde-sync.js';
import { loadKey, saveKey, clearKey } from '../rekorde-keystore.js';

// ------------------------------------------------------------------ Singleton

let store = null;
let sync = null;
let keyCache = null;
let syncStatus = { state: 'aus' };
const statusListeners = new Set();

async function currentKey() {
  if (keyCache) return keyCache;
  keyCache = await loadKey();
  return keyCache;
}

function buildSync() {
  sync = new SyncClient({
    store,
    getKey: currentKey,
    onRemoteState: st => {
      // Verwerfungen, offizielle Werte und Ziele zusammenfuehren statt ueberschreiben
      const m = R.mergeStates(store.state, st);
      store.adoptExternal(m.state);
      if (m.localNewer) sync.schedulePush();
    },
    onStatus: st => { syncStatus = st; for (const fn of statusListeners) fn(st); },
  });
}

export function rekordeStore() {
  if (store) return store;
  store = new R.RekordeStore();
  store.load();
  store.watchOtherWindows();
  buildSync();
  if (sync.enabled) {
    currentKey().then(k => { if (k) sync.start(); else sync._emit('gesperrt'); });
  }
  return store;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ Karte je Sportart

const KIND_OPTIONS = [
  ['time', 'Zeit'],
  ['weight', 'Gewicht in kg'],
  ['reps', 'Wiederholungen'],
  ['distance', 'Distanz'],
  ['number', 'Zahl mit eigener Einheit'],
];

export function rekordeCard(sport, sportLabel) {
  const st = rekordeStore();
  const body = h('div', { class: 'rk' });
  const open = new Set();            // aufgeklappte Kategorien
  let editing = null;                // Kategorie mit offenem Eintragsformular

  const render = () => {
    const cats = st.state.categories.filter(c => c.sport === sport);
    body.replaceChildren();
    if (cats.length) {
      body.append(h('div', { class: 'rk-list' }, cats.map(c => categoryBlock(c))));
    } else {
      body.append(h('p', { class: 'muted rk-empty', text: `Noch keine eigenen Kategorien für ${sportLabel}.` }));
    }
    body.append(newCategoryForm());
    if (!st.storageOk) body.append(h('p', { class: 'form-error', text: 'Der Browser erlaubt keinen lokalen Speicher — Einträge gehen beim Schließen verloren.' }));
  };

  function categoryBlock(c) {
    const best = R.bestEntry(c);
    const last = R.lastEntry(c);
    const isOpen = open.has(c.id);
    const head = h('div', { class: 'rk-head' },
      h('div', { class: 'rk-name' },
        h('span', { class: 'rk-title', text: c.name }),
        h('span', { class: 'muted', text: `${R.KINDS[c.kind].label}${c.kind === 'number' && c.unit ? ` (${c.unit})` : ''} · ${c.better === 'lower' ? 'weniger ist besser' : 'mehr ist besser'}` })),
      h('div', { class: 'rk-best' },
        best ? h('b', { text: R.formatValue(c, best.value) }) : h('span', { class: 'muted', text: 'noch kein Eintrag' }),
        best ? h('span', { class: 'muted', text: `am ${F.dateShort(best.date)}` }) : null),
      h('div', { class: 'rk-actions' },
        btn('Eintragen', () => { editing = editing === c.id ? null : c.id; render(); focusValue(c.id); }, 'primary'),
        btn(isOpen ? 'Einträge ▴' : `Einträge (${c.entries.length}) ▾`, () => { isOpen ? open.delete(c.id) : open.add(c.id); render(); }),
        btn('Umbenennen', () => {
          const n = prompt('Neuer Name der Kategorie:', c.name);
          if (n && n.trim()) st.commit(s => R.renameCategory(s, c.id, n), 'umbenennen');
        }),
        btn('Leeren', () => {
          if (!c.entries.length) return;
          if (confirm(`Alle ${c.entries.length} Einträge von „${c.name}“ löschen? Die Kategorie bleibt.`)) st.commit(s => R.clearCategory(s, c.id), 'leeren');
        }, 'danger', !c.entries.length),
        btn('Löschen', () => {
          if (confirm(`Kategorie „${c.name}“ mit ${c.entries.length} Einträgen löschen?`)) st.commit(s => R.removeCategory(s, c.id), 'löschen');
        }, 'danger')));
    const parts = [head];
    if (editing === c.id) parts.push(entryForm(c));
    if (isOpen) {
      parts.push(c.entries.length ? table(c.entries.slice().reverse(), [
        { label: 'Datum', value: e => F.dateShort(e.date) },
        { label: 'Leistung', value: e => (best && e.id === best.id ? h('b', { text: `${R.formatValue(c, e.value)} ★` }) : R.formatValue(c, e.value)), num: true },
        { label: 'Notiz', value: e => e.note || '' },
        { label: '', value: e => btn('Löschen', () => st.commit(s => R.removeEntry(s, c.id, e.id), 'eintrag löschen'), 'danger small') },
      ]) : h('p', { class: 'muted', text: 'Keine Einträge.' }));
    }
    if (last && best && last.id !== best.id && !isOpen) {
      parts.push(h('p', { class: 'muted rk-last', text: `Zuletzt: ${R.formatValue(c, last.value)} am ${F.dateShort(last.date)}` }));
    }
    return h('div', { class: 'rk-cat', dataset: { id: c.id } }, parts);
  }

  function entryForm(c) {
    const date = h('input', { type: 'date', class: 'input', value: today(), max: today(), 'aria-label': 'Datum', required: true });
    const val = h('input', { type: 'text', class: 'input rk-value', placeholder: R.inputHint(c), 'aria-label': 'Leistung', inputmode: c.kind === 'time' ? 'text' : 'decimal', autocomplete: 'off' });
    const note = h('input', { type: 'text', class: 'input', placeholder: 'Notiz (optional)', maxlength: 200, 'aria-label': 'Notiz' });
    const err = h('span', { class: 'form-error' });
    const form = h('form', { class: 'rk-form' }, date, val, note, h('button', { type: 'submit', class: 'btn primary', text: 'Speichern' }),
      h('button', { type: 'button', class: 'btn', text: 'Abbrechen', onclick: () => { editing = null; render(); } }), err);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = R.parseValue(c, val.value);
      if (v == null) { err.textContent = `Wert nicht lesbar (${R.inputHint(c)}).`; val.focus(); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { err.textContent = 'Datum fehlt.'; return; }
      editing = null;
      st.commit(s => R.addEntry(s, c.id, { date: date.value, value: v, note: note.value }), 'eintrag');
    });
    return form;
  }

  function focusValue(id) {
    queueMicrotask(() => body.querySelector(`.rk-cat[data-id="${CSS.escape(id)}"] .rk-value`)?.focus());
  }

  function newCategoryForm() {
    const PH = { run: 'z. B. Parkrun 5 km', ride: 'z. B. Zeitfahren 20 km', swim: 'z. B. 1500 m Freiwasser', strength: 'z. B. Kniebeuge 1RM', other: 'z. B. Plank' };
    const name = h('input', { type: 'text', class: 'input', placeholder: PH[sport] || 'Name der Kategorie', maxlength: 80, 'aria-label': 'Name', required: true });
    const allowed = R.KINDS_BY_SPORT[sport] || Object.keys(R.KINDS);
    const kind = h('select', { class: 'input', 'aria-label': 'Art' },
      KIND_OPTIONS.filter(([v]) => allowed.includes(v)).map(([v, t]) => h('option', { value: v, text: t })));
    kind.value = allowed[0];
    const unit = h('input', { type: 'text', class: 'input rk-unit', placeholder: 'Einheit', maxlength: 20, 'aria-label': 'Einheit' });
    const dunit = h('select', { class: 'input rk-unit', 'aria-label': 'Einheit' }, h('option', { value: 'km', text: 'km' }), h('option', { value: 'm', text: 'm' }));
    const better = h('select', { class: 'input', 'aria-label': 'Besser ist' },
      h('option', { value: 'higher', text: 'mehr ist besser' }), h('option', { value: 'lower', text: 'weniger ist besser' }));
    const err = h('span', { class: 'form-error' });
    const sync2 = () => {
      unit.hidden = kind.value !== 'number';
      dunit.hidden = kind.value !== 'distance';
      better.value = R.KINDS[kind.value].better;
    };
    kind.addEventListener('change', sync2);
    sync2();
    const form = h('form', { class: 'rk-form rk-new' },
      h('span', { class: 'rk-new-label', text: 'Neue Kategorie' }), name, kind, unit, dunit, better,
      h('button', { type: 'submit', class: 'btn', text: '+ Anlegen' }), err);
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'Name fehlt.'; name.focus(); return; }
      let created;
      st.commit(s => {
        created = R.addCategory(s, {
          name: name.value, sport, kind: kind.value,
          unit: kind.value === 'number' ? unit.value.trim() : kind.value === 'distance' ? dunit.value : '',
          better: better.value,
        });
      }, 'kategorie');
      editing = created.id;
      render();
      focusValue(created.id);
    });
    return form;
  }

  const unsub = st.subscribe(() => { if (!body.isConnected) { unsub(); return; } render(); });
  render();
  return card(`Eigene Bestleistungen · ${sportLabel}`, body, { sub: 'Von Hand eingetragen', actions: syncButton() });
}

function btn(text, onclick, cls = '', disabled = false) {
  return h('button', { type: 'button', class: `mini-btn ${cls}`, text, onclick, disabled });
}

// ------------------------------------------------------------------ Abgleich

const BADGE = {
  aus: 'Nur auf diesem Gerät',
  gesperrt: 'Abgleich gesperrt',
  ok: 'Abgeglichen',
  offline: 'Offline',
  konflikt: 'Abgleich: Konflikt',
  fehler: 'Abgleich: Fehler',
};

function syncButton() {
  const b = h('button', { type: 'button', class: 'mini-btn sync-badge' });
  const paint = s => {
    b.textContent = BADGE[s.state] || BADGE.aus;
    b.dataset.state = s.state;
    b.title = `${BADGE[s.state] || ''}${s.detail ? ` — ${s.detail}` : ''}${s.updatedAt ? ` · Stand ${new Date(s.updatedAt).toLocaleString('de-AT')}` : ''} (klicken zum Einrichten)`;
  };
  paint(sync && sync.enabled ? syncStatus : { state: 'aus' });
  const l = s => { if (!b.isConnected) { statusListeners.delete(l); return; } paint(s); };
  statusListeners.add(l);
  b.addEventListener('click', openSyncDialog);
  return b;
}

let dlg = null;
function openSyncDialog() {
  if (!dlg) dlg = buildDialog();
  const cfg = loadConfig();
  const fromK = !cfg ? kalenderConfig() : null;
  const use = cfg || fromK;
  dlg.url.value = use ? use.url : '';
  dlg.token.value = use ? use.token : '';
  dlg.fromK.hidden = !fromK;
  dlg.pass.value = ''; dlg.pass2.value = '';
  dlg.msg.textContent = cfg ? 'Eingerichtet. Passphrase nur nötig, um dieses Gerät zu entsperren.' : '';
  dlg.off.hidden = !cfg;
  const liste = conflictCopies();
  dlg.conf.textContent = liste.length ? `${liste.length} Sicherung(en) aus Konflikten im Browser: ${liste.map(k => k.replace(CONFLICT_PREFIX, '')).join(', ')}` : '';
  dlg.el.showModal();
}

function buildDialog() {
  const url = h('input', { class: 'input', type: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://….workers.dev' });
  const token = h('input', { class: 'input', type: 'password', autocomplete: 'off' });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'off' });
  const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'off' });
  const msg = h('p', { class: 'note', role: 'status' });
  const conf = h('p', { class: 'note' });
  const fromK = h('p', { class: 'note', text: 'Adresse und Token aus dem Kalender übernommen.' });
  const off = h('button', { type: 'button', class: 'btn', text: 'Abgleich ausschalten' });
  const save = h('button', { type: 'button', class: 'btn primary', text: 'Verbinden' });
  const cancel = h('button', { type: 'button', class: 'btn', text: 'Abbrechen' });
  const el = h('dialog', { class: 'dlg', 'aria-label': 'Abgleich der eigenen Bestleistungen' },
    h('h2', { text: 'Abgleich zwischen Geräten' }),
    h('p', { class: 'note', text: 'Derselbe Worker wie Kalender und Projekte, eigener verschlüsselter Block. Verschlüsselt wird im Browser; die Passphrase verlässt das Gerät nicht. Vergessen heißt weg.' }),
    h('label', { class: 'fld' }, h('span', { text: 'Adresse des Workers' }), url),
    h('label', { class: 'fld' }, h('span', { text: 'Token' }), token), fromK,
    h('label', { class: 'fld' }, h('span', { text: 'Passphrase (auf allen Geräten dieselbe)' }), pass),
    h('label', { class: 'fld' }, h('span', { text: 'Passphrase wiederholen' }), pass2),
    msg, conf,
    h('div', { class: 'dlg-foot' }, off, h('span', { class: 'spacer' }), cancel, save));
  document.body.append(el);
  cancel.addEventListener('click', () => el.close());
  off.addEventListener('click', async () => {
    if (sync) sync.reconfigure(null);
    saveConfig(null);
    try { await clearKey(); } catch { /* egal */ }
    keyCache = null;
    syncStatus = { state: 'aus' };
    for (const fn of statusListeners) fn(syncStatus);
    el.close();
  });
  save.addEventListener('click', async () => {
    const u = url.value.trim(), t = token.value.trim(), p = pass.value;
    const vorhanden = await currentKey();
    if (!/^https:\/\/\S+$/.test(u) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]\S*$/.test(u)) { msg.textContent = 'Die Adresse muss mit https:// beginnen.'; return; }
    if (!t) { msg.textContent = 'Token fehlt.'; return; }
    if (!p && !vorhanden) { msg.textContent = 'Passphrase fehlt.'; return; }
    if (p && p !== pass2.value) { msg.textContent = 'Die beiden Passphrasen sind nicht gleich.'; return; }
    if (p && p.length < 12) { msg.textContent = 'Bitte mindestens zwölf Zeichen.'; return; }
    const config = { url: u, token: t };
    msg.textContent = 'Verbinde …';
    try {
      if (p) {
        const r = await establishKey(config, p);
        await saveKey(r.key, r.salt, r.iterations);
        keyCache = { key: r.key, salt: r.salt, iterations: r.iterations };
        saveConfig(config);
        // Reihenfolge wie in /projekte: erst Basisversion und Serverstand, dann starten.
        sync.stop();
        sync.setVersion(r.version, null);
        if (r.remoteState) mergeLocalInto(r.remoteState);
        sync.reconfigure(config);
        await sync.pull();
      } else {
        saveConfig(config);
        sync.reconfigure(config);
      }
      el.close();
    } catch (err) {
      msg.textContent = String(err && err.message ? err.message : err);
    }
  });
  return { el, url, token, pass, pass2, msg, conf, fromK, off };
}

// Beim ersten Verbinden eines Geräts, auf dem schon lokal eingetragen wurde:
// Serverstand übernehmen und lokale Kategorien/Einträge, die dort fehlen,
// hinzufügen (statt sie zu verwerfen). Danach lädt der nächste Abgleich hoch.
function mergeLocalInto(remote) {
  const local = store.state;
  const mm = R.mergeStates(local, remote);
  const merged = mm.state;
  let added = mm.localNewer;
  for (const lc of local.categories) {
    const rc = merged.categories.find(c => c.id === lc.id);
    if (!rc) { merged.categories.push(lc); added = true; continue; }
    for (const e of lc.entries) if (!rc.entries.some(x => x.id === e.id)) { rc.entries.push(e); added = true; }
    rc.entries.sort((a, b) => a.date.localeCompare(b.date));
  }
  store.adoptExternal(merged);
  if (added) sync.schedulePush();
}
