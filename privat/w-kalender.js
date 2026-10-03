// w-kalender.js — die obersten drei offenen Aufgaben von heute, abhakbar.
//
// „Oberste“ = Reihenfolge der Aufgabenseite (Feld `order`), nur Aufgaben mit
// Datum heute, nur offene. Abhaken setzt `done: true` — sonst nichts.
//
// Schreibweg, damit der Abgleich des Kalenders nicht durcheinanderkommt:
//   * Abgleich nicht eingerichtet: direkt in localStorage `kalender.v1`
//     (ein offener Kalender-Tab übernimmt das über das storage-Ereignis).
//   * Abgleich eingerichtet und entsperrt: NUR beim Worker, mit demselben
//     Versionsprotokoll wie der Kalender (GET /state, ändern, PUT mit
//     baseVersion, bei 409 neu). Grundlage ist der lokale Stand, wenn er auf
//     der aktuellen Serverversion aufsetzt (so gehen dort noch nicht
//     hochgeladene Änderungen nicht verloren), sonst der Serverstand.
//     localStorage bleibt unberührt: der Kalender sieht beim nächsten Abruf
//     eine neuere Version und übernimmt sie, ohne Schein-Konflikt.
//   * Abgleich eingerichtet, aber auf diesem Gerät gesperrt: nur Anzeige.

import { encryptState, decryptState } from '/kalender/js/crypto.js';
import { loadKey } from '/kalender/js/keystore.js';
import { loadConfig } from '/kalender/js/sync.js';
import { N, el, hinweis, heuteIso } from './kachel-util.js';

const LS = 'kalender.v1';
const META = 'kalender.syncmeta';

function lokal() {
  try { const r = localStorage.getItem(LS); return r ? JSON.parse(r) : null; } catch { return null; }
}
function lokaleVersion() {
  try { return (JSON.parse(localStorage.getItem(META)) || {}).version || 0; } catch { return 0; }
}

export function obersteAufgaben(state, heute = heuteIso()) {
  return (state?.tasks || [])
    .filter((t) => String(t.date).slice(0, 10) === heute && !t.done)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .slice(0, N);
}

class Kalender {
  constructor(liste) {
    this.liste = liste;
    this.cfg = loadConfig();
    this.key = null;
    this.modus = 'lokal';           // lokal | sync | gesperrt
    this.state = null;
  }

  base() { return `${String(this.cfg.url).replace(/\/+$/, '')}`; }

  async req(path, init = {}) {
    return fetch(`${this.base()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }

  async serverStand() {
    const r = await this.req('/state');
    if (!r.ok) throw new Error(`Server antwortet ${r.status}.`);
    const body = await r.json();
    if (!body.blob) return { version: body.version || 0, state: null };
    return { version: body.version, state: await decryptState(this.key.key, body.blob) };
  }

  render(meldung = '') {
    const offen = obersteAufgaben(this.state);
    if (!this.state) { hinweis(this.liste, 'Auf diesem Gerät noch keine Kalenderdaten.'); return; }
    if (!offen.length) { hinweis(this.liste, 'Keine offenen Aufgaben für heute.'); }
    else {
      this.liste.replaceChildren(...offen.map((t) => {
        const z = el('label', 'tl-z tl-check');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.disabled = this.modus === 'gesperrt';
        z.title = cb.disabled ? 'Kalender-Abgleich auf diesem Gerät gesperrt — in /kalender entsperren, um hier abzuhaken.' : 'Als erledigt markieren';
        cb.addEventListener('change', () => this.abhaken(t.id, z, cb));
        z.append(cb, el('span', 'tl-t', t.title));
        return z;
      }));
    }
    if (meldung) this.liste.append(el('div', 'tl-hinweis tl-fehler', meldung));
  }

  async fuellen() {
    if (this.cfg) {
      this.key = await loadKey();
      this.modus = this.key ? 'sync' : 'gesperrt';
    }
    this.state = lokal();
    this.render();
    if (this.modus !== 'sync') return;
    try {
      const srv = await this.serverStand();
      if (srv.state && srv.version > lokaleVersion()) { this.state = srv.state; this.render(); }
    } catch { /* offline: lokaler Stand bleibt */ }
  }

  async abhaken(id, z, cb) {
    cb.disabled = true;
    z.classList.add('erledigt');
    try {
      this.state = this.modus === 'sync' ? await this.schreibenServer(id) : this.schreibenLokal(id);
      setTimeout(() => this.render(), 350);
    } catch (err) {
      z.classList.remove('erledigt');
      cb.checked = false;
      cb.disabled = false;
      this.render(String(err && err.message ? err.message : err));
    }
  }

  schreibenLokal(id) {
    const s = lokal();
    const t = s && s.tasks.find((x) => x.id === id);
    if (!t) throw new Error('Aufgabe nicht mehr vorhanden.');
    t.done = true;
    localStorage.setItem(LS, JSON.stringify(s));
    return s;
  }

  async schreibenServer(id) {
    for (let versuch = 0; versuch < 3; versuch += 1) {
      const srv = await this.serverStand();
      if (!srv.state) return this.schreibenLokal(id);       // Server leer: Kalender lädt selbst hoch
      const l = lokal();
      const basis = (l && srv.version === lokaleVersion()) ? l : srv.state;
      const t = basis.tasks.find((x) => x.id === id);
      if (!t) throw new Error('Aufgabe nicht mehr vorhanden.');
      if (t.done) return basis;
      t.done = true;
      const blob = await encryptState(this.key.key, basis, this.key.salt);
      const r = await this.req('/state', {
        method: 'PUT', body: JSON.stringify({ baseVersion: srv.version, blob }),
      });
      if (r.status === 409) continue;                        // anderes Gerät war schneller
      if (!r.ok) throw new Error(`Server antwortet ${r.status}.`);
      return basis;
    }
    throw new Error('Kalender wird gerade woanders geändert — bitte gleich noch einmal.');
  }
}

export async function fuellen(liste) {
  await new Kalender(liste).fuellen();
}
