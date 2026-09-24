// app.js — Start, Entsperren, Router, Sportartfilter.

import { h, hideTip } from './charts.js';
import * as S from './source.js';
import { buildModel, CATS, CAT_LABEL } from './model.js';
import { catColor } from './ui.js';
import { renderOverview } from './views/overview.js';
import { renderList } from './views/list.js';
import { renderFitness } from './views/fitness.js';
import { renderRecords } from './views/records.js';
import { renderActivity } from './views/activity.js';

const view = document.getElementById('view');
const filterbar = document.getElementById('filterbar');
const footer = document.getElementById('data-info');
const btnLock = document.getElementById('btn-lock');
const btnTheme = document.getElementById('btn-theme');

// ------------------------------------------------------------------ Einstellungen (nur Komfort, pro Browser)

const prefs = {
  get(k, dflt) {
    try { const v = localStorage.getItem(`training.${k}`); return v == null ? dflt : JSON.parse(v); } catch { return dflt; }
  },
  set(k, v) {
    try { localStorage.setItem(`training.${k}`, JSON.stringify(v)); } catch { /* egal */ }
  },
};

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  btnTheme.textContent = t === 'dark' ? '☾' : t === 'light' ? '☀' : '◐';
  btnTheme.title = `Darstellung: ${t === 'dark' ? 'dunkel' : t === 'light' ? 'hell' : 'wie System'}`;
}
applyTheme(prefs.get('theme', 'auto'));
btnTheme.addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  const t = order[(order.indexOf(prefs.get('theme', 'auto')) + 1) % 3];
  prefs.set('theme', t);
  applyTheme(t);
  route();                                   // Diagramme lesen Farben beim Zeichnen nicht, aber sicher ist sicher
});

// ------------------------------------------------------------------ Zustand

let model = null;

function selectedCats() {
  const f = prefs.get('filter', []);
  return Array.isArray(f) ? f.filter(c => CATS.includes(c)) : [];
}

function renderFilter() {
  const present = CATS.filter(c => model.acts.some(a => a.cat === c));
  const sel = selectedCats();
  filterbar.replaceChildren(
    h('button', { type: 'button', class: `chip${sel.length ? '' : ' active'}`, 'aria-pressed': String(!sel.length), text: 'Alle',
      onclick: () => { prefs.set('filter', []); renderFilter(); route(); } }),
    ...present.map(c => h('button', {
      type: 'button', class: `chip${sel.includes(c) ? ' active' : ''}`, 'aria-pressed': String(sel.includes(c)),
      onclick: () => {
        const s = new Set(selectedCats());
        s.has(c) ? s.delete(c) : s.add(c);
        prefs.set('filter', [...s]);
        renderFilter();
        route();
      },
    }, h('span', { class: 'sport-dot', style: { background: catColor(c) } }), CAT_LABEL[c])));
  filterbar.hidden = false;
}

// ------------------------------------------------------------------ Router

const ROUTES = {
  '': ['overview', renderOverview],
  aktivitaeten: ['list', renderList],
  fitness: ['fitness', renderFitness],
  bestleistungen: ['records', renderRecords],
};

let lastPath = null;
function route() {
  if (!model) return;
  hideTip();
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  const parts = path.split('/');
  const sel = selectedCats();
  const acts = sel.length ? model.acts.filter(a => sel.includes(a.cat)) : model.acts;
  const ctx = { model, acts, prefs, query, filtered: sel.length > 0 };
  view.replaceChildren();
  let tab;
  if (parts[0] === 'a' && parts[1]) {
    tab = 'list';
    filterbar.hidden = true;
    renderActivity(view, ctx, decodeURIComponent(parts[1]));
    document.title = `${model.byId.get(decodeURIComponent(parts[1]))?.name || 'Aktivität'} · Training`;
  } else {
    const r = ROUTES[parts[0]] || ROUTES[''];
    tab = r[0];
    filterbar.hidden = false;
    r[1](view, ctx);
    document.title = 'Training';
  }
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ Start

function screen(...kids) {
  filterbar.hidden = true;
  view.replaceChildren(h('div', { class: 'screen' }, h('div', { class: 'screen-card' }, ...kids)));
}

function showSetup(msg) {
  screen(
    h('h1', { text: 'Noch keine Trainingsdaten' }),
    h('p', { text: msg }),
    h('p', {}, 'Die Daten erzeugt das Sync-Skript unter ', h('code', { text: 'training/sync/' }),
      '. Einmalig einrichten und dann regelmäßig ausführen:'),
    h('pre', { text: 'cd training/sync\npip install -r requirements.txt\ncopy config.example.json config.json\npython training_sync.py garmin --push' }),
    h('p', { class: 'muted', text: 'Einzelheiten stehen in training/README.md.' }));
}

function showLock(error) {
  const input = h('input', { type: 'password', class: 'input', autocomplete: 'current-password', 'aria-label': 'Passphrase', placeholder: 'Passphrase', required: true });
  const remember = h('input', { type: 'checkbox', id: 'remember' });
  remember.checked = prefs.get('remember', true);
  const err = h('p', { class: 'form-error', role: 'alert', text: error || '' });
  const btn = h('button', { type: 'submit', class: 'btn primary', text: 'Entsperren' });
  const form = h('form', { class: 'lock-form' },
    h('h1', { text: 'Training' }),
    h('p', { class: 'muted', text: 'Die Trainingsdaten sind verschlüsselt. Die Entschlüsselung passiert nur in diesem Browser.' }),
    input,
    h('label', { class: 'check' }, remember, ' Auf diesem Gerät merken'),
    err, btn);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!input.value) return;
    btn.disabled = true; btn.textContent = 'Prüfe …'; err.textContent = '';
    prefs.set('remember', remember.checked);
    try {
      await S.unlock(input.value, remember.checked);
      await start();
    } catch (ex) {
      btn.disabled = false; btn.textContent = 'Entsperren';
      err.textContent = ex instanceof S.WrongPassphraseError ? 'Falsche Passphrase.' : `Fehler: ${ex.message}`;
      input.select();
    }
  });
  screen(form);
  input.focus();
}

async function start() {
  const index = await S.loadIndex();
  model = buildModel(index);
  btnLock.hidden = !S.isEncrypted();
  const gen = index.generated ? new Date(index.generated) : null;
  footer.textContent = `${model.acts.length} Aktivitäten${gen ? ` · Datenstand ${gen.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`;
  renderFilter();
  route();
}

async function boot() {
  try {
    await S.loadManifest();
  } catch (e) {
    if (e instanceof S.NoDataError) return showSetup(e.message);
    throw e;
  }
  if (S.isEncrypted() && !globalThis.crypto?.subtle) {
    return screen(h('h1', { text: 'Nicht verfügbar' }), h('p', { text: 'Entschlüsselung braucht HTTPS (WebCrypto).' }));
  }
  if (S.isEncrypted() && !(await S.restoreKey())) return showLock();
  try {
    await start();
  } catch (e) {
    if (e instanceof S.LockedError || e instanceof S.WrongPassphraseError) {
      await S.forgetKey();
      return showLock(e instanceof S.WrongPassphraseError ? 'Der gespeicherte Schlüssel passt nicht mehr (neue Passphrase?).' : '');
    }
    screen(h('h1', { text: 'Fehler' }), h('p', { text: e.message }));
    console.error(e);
  }
}

btnLock.addEventListener('click', async () => {
  await S.forgetKey();
  model = null;
  btnLock.hidden = true;
  footer.textContent = '';
  showLock();
});

boot();
