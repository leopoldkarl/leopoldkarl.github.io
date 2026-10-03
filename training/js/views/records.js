// Bestleistungen: Leistungskurve (Rad), Bestzeiten und Pace-Kurve (Laufen),
// Bestzeiten Schwimmen; dazu je Sportart eigene, von Hand gepflegte Kategorien
// (auch Kraft und Sonstiges).
//
// Automatische Bestwerte lassen sich verwerfen (GPS-Fehler): einzeln je Wert
// oder fuer eine ganze Aktivitaet. Die Liste liegt im selben Block wie die
// eigenen Bestleistungen (rekorde.js, `excluded`) und wird mit abgeglichen.

import { h, curveChart } from '../charts.js';
import * as F from '../format.js';
import * as M from '../model.js';
import * as R from '../rekorde.js';
import { card, segmented, table, emptyNote } from '../ui.js';
import { rekordeStore, rekordeCard } from './rekorde-view.js';

const RUN_D = ['100', '200', '300', '400', '800', '1000', '1500', '1609', '2000', '3000', '5000', '10000', '15000', '21097', '30000', '42195'];
const RIDE_D = ['5000', '10000', '20000', '40000', '50000', '100000', '160934'];
const SWIM_D = ['100', '200', '400', '800', '1000', '1500', '1900', '3800'];
const KEY_DUR = [5, 15, 60, 300, 1200, 3600];
// Ab wann eine Sportart fuer Bestwerte zaehlt (lokale Startzeit, ISO); aeltere Aktivitaeten bleiben unberuecksichtigt
const BEST_SINCE = { swim: '2026-10-03T17:30' };
const NONE = { run: 'noch nicht gelaufen', ride: 'noch nicht gefahren', swim: 'noch nicht geschwommen' };

// Mean-Max-Huelle ohne verworfene Werte
function envelopeEx(list, key, ex) {
  const best = M.DURATIONS.map(() => null);
  for (const a of list) {
    const mm = a[key];
    if (!mm) continue;
    mm.forEach((v, i) => {
      if (v == null || ex(a.id, `${key}:${M.DURATIONS[i]}`)) return;
      if (best[i] == null || v > best[i].v) best[i] = { v, a };
    });
  }
  return best;
}

function bestTimesEx(list, dist, n, ex) {
  return M.bestTimes(list.filter(a => !ex(a.id, `best:${dist}`)), dist, n);
}

export function renderRecords(root, ctx) {
  const { acts, prefs } = ctx;
  const st = rekordeStore();
  const has = c => acts.some(a => a.cat === c);
  const manual = new Set(st.state.categories.map(c => c.sport));
  const ALL = [['ride', 'Rad'], ['run', 'Laufen'], ['swim', 'Schwimmen'], ['strength', 'Kraft'], ['other', 'Sonstiges']];
  const sports = ALL.filter(([c]) => has(c) || manual.has(c) || c === 'strength' || c === 'other');
  const label = Object.fromEntries(ALL);
  let sport = prefs.get('rec.sport', sports[0][0]);
  if (!sports.some(([c]) => c === sport)) sport = sports[0][0];
  const body = h('div');
  root.append(h('div', { class: 'view-head' },
    segmented(sports, sport, v => { sport = v; prefs.set('rec.sport', v); draw(v); }, 'Sportart')), body);

  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d90 = M.dayKey(M.addDays(t0, -90));
  const y0 = `${t0.getFullYear()}-01-01`;
  const link = a => h('a', { href: `#/a/${encodeURIComponent(a.id)}`, text: F.dateShort(a.start) });

  // Neu zeichnen, wenn sich die Verwerfungen aendern (auch vom anderen Geraet)
  const sig = () => JSON.stringify([st.state.excluded || [], st.state.marks || []]);
  let lastEx = sig();
  const unsub = st.subscribe(() => {
    if (!body.isConnected) { unsub(); return; }
    const now = sig();
    if (now !== lastEx) { lastEx = now; const y = window.scrollY; draw(sport); window.scrollTo(0, y); }
  });

  // Verwerfen: kleines Auswahlfenster (nur dieser Wert / ganze Aktivitaet)
  const discard = (a, metric, what) => askDiscard(a, what, choice => {
    if (choice === 'one') st.commit(s => R.exclude(s, a.id, metric), 'verwerfen');
    if (choice === 'all') st.commit(s => R.exclude(s, a.id, '*'), 'verwerfen');
  });
  const xBtn = (a, metric, what) => h('button', {
    type: 'button', class: 'mini-btn danger small', text: '✕', title: 'Wert verwerfen (z. B. GPS-Fehler)',
    'aria-label': `${what} verwerfen`, onclick: () => discard(a, metric, what),
  });

  function draw(sp) {
    body.replaceChildren();
    const ex = R.exclusionTest(st.state);
    const since = BEST_SINCE[sp];
    const list = acts.filter(a => a.cat === sp && (!since || String(a.start) >= since));
    const recent = list.filter(a => a.day >= d90);
    const thisYear = list.filter(a => a.day >= y0);

    if (sp === 'ride') {
      const withPw = list.filter(a => a.mm_pw);
      if (withPw.length) {
        const all = envelopeEx(withPw, 'mm_pw', ex), r90 = envelopeEx(recent, 'mm_pw', ex), yr = envelopeEx(thisYear, 'mm_pw', ex);
        const th = ctx.model.thAt(M.dayKey(t0));
        const kg = th.weight;
        const host = h('div');
        body.append(card('Leistungskurve', host, { sub: 'Beste mittlere Leistung je Dauer (Mean-Max)' }));
        curveChart(host, {
          x: M.DURATIONS, height: 280,
          xFmt: F.durLabel, yFmt: v => `${Math.round(v)} W${kg ? ` · ${F.num(v / kg, 1)}` : ''}`,
          series: [
            { label: 'Letzte 90 Tage', color: 'var(--c-s1)', values: r90.map(x => x?.v ?? null), meta: i => r90[i] && F.dateShort(r90[i].a.start) },
            { label: String(t0.getFullYear()), color: 'var(--c-s2)', values: yr.map(x => x?.v ?? null), meta: i => yr[i] && F.dateShort(yr[i].a.start), thin: true },
            { label: 'Gesamt', color: 'var(--c-prev1)', values: all.map(x => x?.v ?? null), meta: i => all[i] && F.dateShort(all[i].a.start), thin: true },
          ],
          onClick: i => { const x = r90[i] || all[i]; if (x) location.hash = `#/a/${encodeURIComponent(x.a.id)}`; },
        });
        const idx = d => M.DURATIONS.indexOf(d);
        body.append(card('Leistungs-Bestwerte', table(KEY_DUR.map(d => ({ d, all: all[idx(d)], r90: r90[idx(d)], yr: yr[idx(d)] })), [
          { label: 'Dauer', value: r => F.durLabel(r.d) },
          { label: 'Gesamt', value: r => r.all ? `${Math.round(r.all.v)} W${kg ? ` (${F.num(r.all.v / kg, 2)} W/kg)` : ''}` : F.DASH, num: true },
          { label: 'am', value: r => r.all ? link(r.all.a) : F.DASH },
          { label: String(t0.getFullYear()), value: r => r.yr ? `${Math.round(r.yr.v)} W` : F.DASH, num: true },
          { label: '90 Tage', value: r => r.r90 ? `${Math.round(r.r90.v)} W` : F.DASH, num: true },
          { label: '', value: r => r.all ? xBtn(r.all.a, `mm_pw:${r.d}`, `${F.durLabel(r.d)}: ${Math.round(r.all.v)} W`) : '' },
        ]), { sub: '✕ verwirft einen Wert, danach gilt der nächstbeste' }));
      } else {
        body.append(card('Leistungskurve', emptyNote('Keine Radaktivitäten mit Leistungsmesser.')));
      }
      body.append(distanceTable('Schnellste Abschnitte', list, RIDE_D, recent, thisYear, (t, d) => F.kmh(d / t), sp));
    }

    if (sp === 'run') {
      body.append(distanceTable('Bestzeiten', list, RUN_D, recent, thisYear, (t, d) => F.pace(d / t, 1000), sp));
      const all = envelopeEx(list, 'mm_v', ex), r90 = envelopeEx(recent, 'mm_v', ex);
      const toPace = e => e.map(x => (x && x.v > 0.5 ? 1000 / x.v : null));
      const host = h('div');
      body.append(card('Pace-Kurve', host, { sub: 'Schnellste mittlere Geschwindigkeit je Dauer (GPS, ungeglättet). Unplausible Spitzen: Aktivität in „Bestzeiten“ oder auf ihrer Seite ignorieren.' }));
      const vals = toPace(all).filter((v, i) => v != null && M.DURATIONS[i] >= 30);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      curveChart(host, {
        x: M.DURATIONS, height: 260, invert: true,
        domain: vals.length ? [Math.floor(lo / 15) * 15, Math.ceil(hi / 15) * 15 + 15] : undefined,
        xFmt: F.durLabel, yFmt: v => `${F.pace(1000 / v, 1000, false)} /km`,
        series: [
          { label: 'Letzte 90 Tage', color: 'var(--c-s1)', values: toPace(r90).map((v, i) => M.DURATIONS[i] < 30 ? null : v), meta: i => r90[i] && F.dateShort(r90[i].a.start) },
          { label: 'Gesamt', color: 'var(--c-prev1)', values: toPace(all).map((v, i) => M.DURATIONS[i] < 30 ? null : v), meta: i => all[i] && F.dateShort(all[i].a.start), thin: true },
        ],
        onClick: i => { const x = all[i]; if (x) location.hash = `#/a/${encodeURIComponent(x.a.id)}`; },
      });
    }

    if (sp === 'swim') {
      body.append(distanceTable('Bestzeiten', list, SWIM_D, recent, thisYear, (t, d) => F.pace(d / t, 100), sp, true));
    }

    body.append(rekordeCard(sp, label[sp]));
    const exCard = excludedCard(sp);
    if (exCard) body.append(exCard);
  }

  // Offizielle Werte/Ziele: Eintrag im Store, sonst Vorgabe aus der config (index.athlete.marks)
  function markValue(sp, kind, d) {
    const v = R.markOf(st.state, sp, kind, d);
    if (v !== undefined) return v;
    const def = ctx.model.marks?.[sp]?.[kind]?.[String(d)];
    return Number.isFinite(def) && def > 0 ? def : null;
  }

  function editCell(sp, kind, d, label) {
    const v = markValue(sp, kind, d);
    const wrap = h('span', { class: 'mark-cell' });
    const show = () => {
      wrap.replaceChildren(h('button', {
        type: 'button', class: `mark-btn${v == null ? ' empty' : ''}${kind === 'official' ? ' strong' : ''}`,
        text: v == null ? '＋' : F.duration(v), title: `${label} für ${F.distLabel(d)} ${v == null ? 'eintragen' : 'ändern (leer lassen = löschen)'}`,
        onclick: edit,
      }));
    };
    const edit = () => {
      const inp = h('input', { type: 'text', class: 'input mark-input', value: v == null ? '' : F.duration(v),
        placeholder: kind === 'goal' ? 'z. B. 2\'40"' : 'z. B. 1:13:30', 'aria-label': `${label} ${F.distLabel(d)}` });
      let done = false;
      const save = () => {
        if (done) return; done = true;
        const t = inp.value.trim();
        if (!t) { if (v != null) st.commit(s => R.setMark(s, sp, kind, d, null), 'mark'); else show(); return; }
        const sec = R.parseTime(t);
        if (sec == null) { done = false; inp.classList.add('bad'); inp.title = 'Nicht lesbar: z. B. 13" · 2\'40" · 73\'30" · 1:13:30'; return; }
        if (sec === v) { show(); return; }
        st.commit(s => R.setMark(s, sp, kind, d, sec), 'mark');
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { done = true; show(); }
      });
      inp.addEventListener('blur', save);
      wrap.replaceChildren(inp);
      inp.focus(); inp.select();
    };
    show();
    return wrap;
  }

  function distanceTable(title, list, dists, recent, thisYear, paceFmt, sp, allRows = false) {
    const ex = R.exclusionTest(st.state);
    const rows = dists.map(d => {
      const all = bestTimesEx(list, d, 3, ex);
      const official = markValue(sp, 'official', +d), goal = markValue(sp, 'goal', +d);
      const known = [all[0]?.t, official].filter(x => x != null);
      return {
        d: +d, all, official, goal,
        best: known.length ? Math.min(...known) : null,
        yr: bestTimesEx(thisYear, d, 1, ex)[0],
        r90: bestTimesEx(recent, d, 1, ex)[0],
        hadData: list.some(a => a.best?.[d] != null),
      };
    }).filter(r => allRows || r.all.length || r.hadData || r.official != null || r.goal != null);
    if (!rows.length) return card(title, emptyNote('Noch keine Daten.'));
    const none = NONE[sp] || '–';
    const delta = r => {
      if (r.goal == null || r.best == null) return F.DASH;
      const dlt = r.best - r.goal;
      return dlt <= 0 ? h('span', { class: 'goal-ok', text: '✓ erreicht' }) : h('span', { class: 'goal-gap', text: `+${F.duration(dlt)}` });
    };
    const tbl = table(rows, [
      { label: 'Distanz', value: r => F.distLabel(r.d) },
      { label: sp === 'swim' ? 'Uhr-Bestzeit' : 'GPS-Bestzeit', value: r => r.all[0] ? h('b', { text: F.duration(r.all[0].t) }) : h('span', { class: 'muted', text: r.hadData ? none : F.DASH }), num: true },
      { label: 'am', value: r => r.all[0] ? link(r.all[0].a) : F.DASH },
      { label: 'Offiziell', value: r => editCell(sp, 'official', r.d, 'Offizielle Zeit'), num: true },
      { label: 'Ziel', value: r => editCell(sp, 'goal', r.d, 'Ziel'), num: true },
      { label: 'Zielpace', value: r => r.goal != null ? paceFmt(r.goal, r.d) : F.DASH, num: true },
      { label: 'Δ zum Ziel', value: delta, num: true },
      { label: String(t0.getFullYear()), value: r => r.yr ? F.duration(r.yr.t) : F.DASH, num: true },
      { label: '90 Tage', value: r => r.r90 ? F.duration(r.r90.t) : F.DASH, num: true },
      { label: '2. / 3.', value: r => r.all.slice(1).map(x => F.duration(x.t)).join(' · ') || F.DASH, num: true },
      { label: '', value: r => r.all[0] ? xBtn(r.all[0].a, `best:${r.d}`, `${F.distLabel(r.d)} in ${F.duration(r.all[0].t)}`) : '' },
    ]);
    const since = BEST_SINCE[sp];
    const from = since ? `Gewertet werden nur Aktivitäten ab ${F.dateShort(since)}. ` : '';
    const pace = sp === 'swim' ? 'Zielpace je 100 m. ' : '';
    const src = sp === 'swim' ? 'Uhr' : 'GPS';
    return card(title, tbl, { sub: from + pace + `${src}: schnellster Abschnitt innerhalb einer Aktivität. „Offiziell“ (eigener Wert) und „Ziel“ per Klick eintragen (z. B. 13" · 2'40" · 1:13:30; leer = löschen). Δ vergleicht das Ziel mit der besseren Zeit aus ${src} und offiziell. ✕ verwirft einen ${src}-Wert dauerhaft.` });
  }

  function excludedCard(sp) {
    const byId = ctx.model.byId;
    const items = R.activeExclusions(st.state)
      .map(x => ({ ...x, a: byId.get(x.aid) }))
      .filter(x => x.a && x.a.cat === sp)
      .sort((p, q) => q.at.localeCompare(p.at));
    if (!items.length) return null;
    const what = m => {
      if (m === '*') return 'alle Bestwerte der Aktivität';
      const [k, v] = m.split(':');
      if (k === 'best') return `Bestzeit ${F.distLabel(+v)}`;
      if (k === 'mm_pw') return `Leistung ${F.durLabel(+v)}`;
      return `Tempo ${F.durLabel(+v)}`;
    };
    return card('Verworfene Bestwerte', table(items, [
      { label: 'Aktivität', value: x => h('a', { href: `#/a/${encodeURIComponent(x.a.id)}`, text: `${F.dateShort(x.a.start)} · ${x.a.name}` }) },
      { label: 'Verworfen', value: x => what(x.metric) },
      { label: '', value: x => h('button', { type: 'button', class: 'mini-btn small', text: 'Wiederherstellen',
        onclick: () => st.commit(s => R.restore(s, x.aid, x.metric), 'wiederherstellen') }) },
    ]), { sub: 'Diese Werte zählen nicht als Bestleistung.' });
  }

  draw(sport);
}

// ------------------------------------------------------------------ Auswahlfenster

let dlg = null;
function askDiscard(a, what, done) {
  if (!dlg) {
    const title = h('h2', { text: 'Bestwert verwerfen' });
    const text = h('p', { class: 'note' });
    const one = h('button', { type: 'button', class: 'btn primary', text: 'Nur diesen Wert' });
    const all = h('button', { type: 'button', class: 'btn', text: 'Ganze Aktivität ignorieren' });
    const cancel = h('button', { type: 'button', class: 'btn', text: 'Abbrechen' });
    const el = h('dialog', { class: 'dlg', 'aria-label': 'Bestwert verwerfen' }, title, text,
      h('p', { class: 'note', text: '„Ganze Aktivität ignorieren“ nimmt alle ihre Bestzeiten und Kurvenwerte heraus — sinnvoll, wenn das GPS die ganze Aufzeichnung verfälscht hat. Rückgängig über „Verworfene Bestwerte“.' }),
      h('div', { class: 'dlg-foot' }, cancel, h('span', { class: 'spacer' }), all, one));
    document.body.append(el);
    dlg = { el, text, one, all, cancel, cb: null };
    const finish = c => { el.close(); const cb = dlg.cb; dlg.cb = null; if (cb && c) cb(c); };
    one.addEventListener('click', () => finish('one'));
    all.addEventListener('click', () => finish('all'));
    cancel.addEventListener('click', () => finish(null));
    el.addEventListener('cancel', () => { dlg.cb = null; });
  }
  dlg.text.textContent = `${what} aus „${a.name}“ vom ${F.dateShort(a.start)}.`;
  dlg.cb = done;
  dlg.el.showModal();
}

// Fuer die Aktivitaetsseite: ignoriert? / umschalten
export function activityIgnored(aid) {
  const st = rekordeStore();
  return R.activeExclusions(st.state).some(x => x.aid === aid && x.metric === '*');
}

export function toggleActivityIgnored(aid) {
  const st = rekordeStore();
  if (activityIgnored(aid)) st.commit(s => R.restore(s, aid, '*'), 'wiederherstellen');
  else st.commit(s => R.exclude(s, aid, '*'), 'verwerfen');
}
