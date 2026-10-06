// views.js — reine Render-Funktionen: Zustand rein, HTML-Text raus.
// Ereignisse hängt app.js per Delegation über data-act an.

import {
  STATUS, STATUS_LABEL, COLORS, dayNum, fromDayNum, todayIso, formatDate,
  summarize, milestoneProgress, milestoneComplete, actualSeries, plannedAt, sortProjects,
  allTags, matchesTags,
  offerClose,
} from './model.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function relDays(n) {
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
}

/** Datum mit Jahr nur, wenn es nicht das laufende ist. */
function shortDate(iso) {
  if (!iso) return '';
  return formatDate(iso, { year: iso.slice(0, 4) !== todayIso().slice(0, 4) });
}

function lagText(s) {
  if (s.health === 'fertig') return { text: 'fertig', cls: 'h-fertig' };
  if (s.health === 'ueberfaellig') return { text: 'Ziel überschritten', cls: 'h-verzug' };
  if (s.lagDays == null) return null;
  const d = s.lagDays;
  const cls = s.health ? `h-${s.health}` : '';
  if (Math.abs(d) <= 1) return { text: 'im Plan', cls };
  return d > 0
    ? { text: `${d} Tage Rückstand`, cls }
    : { text: `${-d} Tage Vorsprung`, cls: 'h-gut' };
}

function statusChip(status) {
  return `<span class="chip st-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

/** Tags eines Projekts als Knöpfe; ein Klick filtert die Übersicht danach. */
function tagChips(p, selected = []) {
  if (!p.tags.length) return '';
  return `<div class="tags">${p.tags.map((t) => {
    const on = selected.some((x) => x.toLocaleLowerCase('de') === t.toLocaleLowerCase('de'));
    return `<button type="button" class="tag${on ? ' on' : ''}" data-act="tag" data-tag="${esc(t)}" title="Nur Projekte mit „${esc(t)}“ zeigen">#${esc(t)}</button>`;
  }).join('')}</div>`;
}

/**
 * Tag-Leiste über Übersicht und Zeitleiste. Gezählt wird innerhalb des
 * Statusfilters, damit die Zahlen zu dem passen, was man sieht. Mehrere
 * gewählte Tags schneiden (UND).
 */
function tagBar(projects, selected) {
  const tags = allTags(projects);
  const known = new Set(tags.map((t) => t.tag.toLocaleLowerCase('de')));
  const stale = selected.filter((t) => !known.has(t.toLocaleLowerCase('de')));
  if (!tags.length && !stale.length) return '';
  const isOn = (t) => selected.some((x) => x.toLocaleLowerCase('de') === t.toLocaleLowerCase('de'));
  return `<div class="tagbar" role="group" aria-label="Nach Tags filtern">
    <span class="muted tagbar-l">Tags</span>
    ${tags.map(({ tag, count }) => `<button type="button" class="tag${isOn(tag) ? ' on' : ''}" data-act="tag" data-tag="${esc(tag)}" aria-pressed="${isOn(tag)}">#${esc(tag)} <span class="n">${count}</span></button>`).join('')}
    ${stale.map((t) => `<button type="button" class="tag on" data-act="tag" data-tag="${esc(t)}" aria-pressed="true" title="Kein Projekt in dieser Auswahl trägt diesen Tag">#${esc(t)} <span class="n">0</span></button>`).join('')}
    ${selected.length ? `<button type="button" class="linklike tag-reset" data-act="tags-reset">Auswahl aufheben${selected.length > 1 ? ' (alle gewählten Tags müssen passen)' : ''}</button>` : ''}
  </div>`;
}

function progressBar(s, { big = false } = {}) {
  const ist = s.ist == null ? 0 : clamp01(s.ist);
  const soll = s.soll == null ? null : clamp01(s.soll);
  return `<div class="bar${big ? ' big' : ''}" role="img" aria-label="Ist ${pct(s.ist)}${soll != null ? `, Soll ${pct(soll)}` : ''}">
    <span class="fill" style="width:${(ist * 100).toFixed(2)}%"></span>
    ${soll != null ? `<span class="soll" style="left:${(soll * 100).toFixed(2)}%" title="Soll heute: ${pct(soll)}"></span>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Übersicht                                                           */
/* ------------------------------------------------------------------ */

export const FILTERS = [
  { id: 'laufend', label: 'Laufend', test: (p) => !['abgeschlossen', 'verworfen'].includes(p.status) },
  { id: 'alle', label: 'Alle', test: () => true },
  { id: 'abgeschlossen', label: 'Abgeschlossen', test: (p) => ['abgeschlossen', 'verworfen'].includes(p.status) },
];

export const SORTS = [
  { id: 'status', label: 'Status, dann Ziel' },
  { id: 'faellig', label: 'Ziel' },
  { id: 'rueckstand', label: 'Rückstand' },
  { id: 'fortschritt', label: 'Fortschritt' },
  { id: 'name', label: 'Name' },
  { id: 'manuell', label: 'Angelegt' },
];

export function renderOverview(state, ui) {
  const today = dayNum(todayIso());
  const filter = FILTERS.find((f) => f.id === ui.filter) || FILTERS[0];
  const byStatus = state.projects.filter(filter.test);
  const list = sortProjects(byStatus.filter((p) => matchesTags(p, ui.tags)), ui.sort, today);

  const laufend = state.projects.filter(FILTERS[0].test);
  const sums = laufend.map((p) => summarize(p, today));
  const verzug = sums.filter((s) => s.health === 'verzug' || s.health === 'ueberfaellig').length;
  const msOver = sums.reduce((a, s) => a + s.overdueMilestones, 0);

  const head = `<div class="toolbar">
    <div class="segmented small" role="group" aria-label="Filter">
      ${FILTERS.map((f) => `<button type="button" data-act="filter" data-id="${f.id}" aria-pressed="${f.id === filter.id}">${f.label}</button>`).join('')}
    </div>
    <label class="sort">Sortieren
      <select data-act="sort">${SORTS.map((o) => `<option value="${o.id}"${o.id === ui.sort ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
    </label>
    <p class="summary muted">${laufend.length} laufend${verzug ? ` · <span class="h-verzug">${verzug} im Verzug</span>` : ''}${msOver ? ` · ${msOver} Meilenstein${msOver === 1 ? '' : 'e'} überfällig` : ''}</p>
  </div>${tagBar(byStatus, ui.tags)}`;

  if (!state.projects.length) {
    return `${head}<div class="empty">
      <h2>Noch keine Projekte</h2>
      <p class="muted">Ein Projekt besteht aus Meilensteinen, ein Meilenstein aus Aufgaben. Der Fortschritt ist der Anteil erledigter Aufgaben (gewichtet), das Soll ergibt sich aus Beginn und den Fälligkeitsdaten.</p>
      <button type="button" class="primary" data-act="new-project">+ Erstes Projekt anlegen</button>
    </div>`;
  }
  if (!list.length) return `${head}<p class="muted empty-small">Keine Projekte in dieser Auswahl.</p>`;

  return `${head}<div class="cards">${list.map((p) => projectCard(p, summarize(p, today), today, ui.tags)).join('')}</div>`;
}

function projectCard(p, s, today, selectedTags) {
  const lag = lagText(s);
  const next = s.next;
  let nextText = '—';
  if (next) {
    const due = next.due || p.due;
    const d = dayNum(due);
    nextText = `${esc(next.title || 'ohne Titel')}${due ? ` · <span class="${d < today ? 'h-verzug' : ''}">${shortDate(due)} (${relDays(d - today)})</span>` : ''}`;
  }
  const dueD = dayNum(p.due);
  return `<article class="card proj" style="--pc:${esc(p.color)}">
    <a class="card-link" href="#/p/${esc(p.id)}">
      <div class="card-top">
        <h3>${esc(p.title)}</h3>
        ${statusChip(p.status)}
      </div>
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
      <div class="pct-row">
        <span class="pct">${pct(s.ist)}</span>
        ${lag ? `<span class="lag ${lag.cls}">${lag.text}</span>` : ''}
      </div>
      ${progressBar(s)}
      <dl class="facts">
        <div><dt>Nächster Meilenstein</dt><dd>${nextText}</dd></div>
        <div><dt>Aufgaben</dt><dd>${s.tasks.done} / ${s.tasks.total}</dd></div>
        <div><dt>Ziel</dt><dd>${p.due ? `${shortDate(p.due)}${s.ist !== 1 && Number.isFinite(dueD) ? ` <span class="muted">(${relDays(dueD - today)})</span>` : ''}` : '—'}</dd></div>
      </dl>
    </a>
    ${tagChips(p, selectedTags)}
    ${offerClose(p, s) ? `<div class="card-actions"><span class="h-fertig">Alle Aufgaben erledigt</span><button type="button" class="primary small" data-act="close-project" data-pid="${esc(p.id)}">Projekt abschließen</button></div>` : ''}
  </article>`;
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export function renderDetail(p, ui) {
  const today = dayNum(todayIso());
  const s = summarize(p, today);
  const lag = lagText(s);
  const dueD = dayNum(p.due);

  let fc = '—';
  if (s.forecast) {
    if (s.forecast.finished) fc = 'fertig';
    else if (s.forecast.day == null) fc = '<span class="muted">kein Tempo (28 T.)</span>';
    else {
      const late = Number.isFinite(dueD) && s.forecast.day > dueD;
      fc = `<span class="${late ? 'h-verzug' : ''}">${shortDate(fromDayNum(s.forecast.day))}</span>`;
    }
  }

  const dates = [
    p.start ? `Beginn ${formatDate(p.start)}` : 'ohne Beginn',
    p.due ? `Ziel ${formatDate(p.due)}${s.ist !== 1 && !p.closedAt ? ` (${relDays(dueD - today)})` : ''}` : 'ohne Ziel',
    p.closedAt ? `${p.status === 'verworfen' ? 'verworfen' : 'abgeschlossen'} am ${formatDate(p.closedAt)}` : '',
  ].filter(Boolean).join(' · ');

  return `<div class="detail" style="--pc:${esc(p.color)}">
    <a href="#/" class="back">← Übersicht</a>
    <div class="d-head">
      <h1>${esc(p.title)}</h1>
      ${statusChip(p.status)}
      <span class="grow"></span>
      <button type="button" data-act="edit-project">Bearbeiten</button>
    </div>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${tagChips(p)}
    <p class="muted dates">${dates}</p>

    <div class="stats">
      <div><span class="k">Ist</span><span class="v">${pct(s.ist)}</span></div>
      <div><span class="k">Soll heute</span><span class="v">${pct(s.soll)}</span></div>
      <div><span class="k">Abstand</span><span class="v ${lag ? lag.cls : ''}">${lag ? lag.text : '—'}</span></div>
      <div><span class="k" title="Lineare Fortschreibung des Tempos der letzten 28 Tage">Prognose</span><span class="v">${fc}</span></div>
      <div><span class="k">Aufgaben</span><span class="v">${s.tasks.done} / ${s.tasks.total}</span></div>
    </div>
    ${progressBar(s, { big: true })}
    ${offerClose(p, s) ? `<div class="close-offer" role="status">
      <span><strong>Alle Aufgaben erledigt.</strong> Das Projekt ist noch „${esc(STATUS_LABEL[p.status])}“.</span>
      <button type="button" class="primary" data-act="close-project">Projekt abschließen</button>
    </div>` : ''}

    ${burnupChart(p, s, today, ui.chartW)}

    <section class="milestones">
      <div class="sec-head">
        <h2>Meilensteine</h2>
        <span class="grow"></span>
        ${ui.hideDone ? '<button type="button" data-act="toggle-done">Erledigte zeigen</button>' : '<button type="button" data-act="toggle-done">Erledigte ausblenden</button>'}
        <button type="button" data-act="new-milestone" class="primary">+ Meilenstein</button>
      </div>
      ${p.milestones.length ? p.milestones.map((m, i) => milestoneBlock(p, m, i, today, ui)).join('')
        : '<p class="muted empty-small">Noch keine Meilensteine. Ohne Meilensteine gibt es keinen Ist-Fortschritt.</p>'}
    </section>

    <section class="notes">
      <h2>Notizen</h2>
      <textarea data-act="notes" data-fk="notes" rows="6" placeholder="Stand, Entscheidungen, offene Fragen …">${esc(p.notes)}</textarea>
    </section>
  </div>`;
}

function milestoneBlock(p, m, i, today, ui) {
  const mp = milestoneProgress(m);
  const complete = milestoneComplete(m);
  const due = m.due || p.due;
  const d = dayNum(due);
  const overdue = !complete && Number.isFinite(d) && d < today;
  const n = p.milestones.length;
  const tasks = ui.hideDone ? m.tasks.filter((t) => !t.done) : m.tasks;
  const hidden = m.tasks.length - tasks.length;

  return `<div class="ms${complete ? ' complete' : ''}" data-mid="${esc(m.id)}">
    <div class="ms-head">
      ${m.tasks.length
        ? `<span class="ring" style="--v:${(mp.value * 100).toFixed(1)}" aria-hidden="true"></span>`
        : `<input type="checkbox" class="ms-check" data-act="toggle-ms" ${m.done ? 'checked' : ''} aria-label="Meilenstein erledigt" />`}
      <button type="button" class="ms-title linklike" data-act="edit-ms">${esc(m.title || 'ohne Titel')}</button>
      ${due ? `<span class="due${overdue ? ' h-verzug' : ''}" title="${m.due ? 'fällig' : 'fällig mit dem Projektziel'}">${m.due ? '' : '↳ '}${shortDate(due)}</span>` : ''}
      <span class="grow"></span>
      <span class="ms-pct">${m.tasks.length ? `${pct(mp.value)}` : ''}</span>
      <span class="ms-move">
        <button type="button" class="icon" data-act="ms-up" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">↑</button>
        <button type="button" class="icon" data-act="ms-down" ${i === n - 1 ? 'disabled' : ''} aria-label="nach unten">↓</button>
      </span>
    </div>
    <ul class="tasks">
      ${tasks.map((t) => `<li class="task${t.done ? ' done' : ''}" data-tid="${esc(t.id)}">
        <input type="checkbox" data-act="toggle-task" ${t.done ? 'checked' : ''} aria-label="erledigt" />
        <input type="text" class="t-title" data-act="task-title" data-fk="t-${esc(t.id)}" value="${esc(t.title)}" aria-label="Aufgabe" />
        ${t.done && t.doneAt ? `<span class="done-at muted" title="erledigt am ${formatDate(t.doneAt)}">${shortDate(t.doneAt)}</span>` : ''}
        <button type="button" class="weight" data-act="weight" title="Gewicht (klicken zum Ändern)">${t.weight}</button>
        <button type="button" class="icon del" data-act="del-task" aria-label="Aufgabe löschen">×</button>
      </li>`).join('')}
      ${hidden ? `<li class="muted hidden-note">${hidden} erledigt ausgeblendet</li>` : ''}
      <li class="task new">
        <span class="plus" aria-hidden="true">+</span>
        <input type="text" class="t-new" data-act="new-task" data-fk="new-${esc(m.id)}" placeholder="Aufgabe hinzufügen (Enter)" aria-label="Neue Aufgabe" />
      </li>
    </ul>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Burn-up-Diagramm                                                    */
/* ------------------------------------------------------------------ */

function monthTicks(x0, x1) {
  const out = [];
  const a = new Date(x0 * 864e5);
  let y = a.getUTCFullYear(); let m = a.getUTCMonth() + 1;
  for (let guard = 0; guard < 400; guard += 1) {
    if (m > 11) { m = 0; y += 1; }
    const d = Math.round(Date.UTC(y, m, 1) / 864e5);
    if (d > x1) break;
    if (d >= x0) out.push({ d, y, m });
    m += 1;
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function burnupChart(p, s, today, width) {
  if (!s.total && !s.curve) return '';
  // Breite in echten Pixeln, damit die Schrift auf dem Handy nicht mitschrumpft.
  const W = Math.round(Math.max(300, Math.min(1080, width || 720)));
  const H = W < 520 ? 190 : 230; const L = 38; const R = 12; const T = 12; const B = 26;

  let x0 = dayNum(p.start);
  if (!Number.isFinite(x0)) x0 = dayNum((p.created || '').slice(0, 10));
  if (!Number.isFinite(x0)) x0 = today - 30;
  let x1 = Math.max(today, dayNum(p.due) || -Infinity);
  if (s.curve) x1 = Math.max(x1, s.curve[s.curve.length - 1][0]);
  const span0 = Math.max(x1 - x0, 14);
  const fcDay = s.forecast && s.forecast.day;
  if (fcDay && fcDay > x1 && fcDay - x0 <= span0 * 1.5) x1 = fcDay;
  x1 = Math.max(x1, x0 + 14);

  const X = (d) => L + ((d - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - v) * (H - T - B);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="g"/>${v % 0.5 === 0 ? `<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v * 100}%</text>` : ''}`).join('');

  const ticks = monthTicks(x0, x1);
  const every = Math.ceil(ticks.length / Math.max(3, Math.floor(W / 70)));
  const xlab = ticks.map((t, i) => `<line x1="${X(t.d)}" x2="${X(t.d)}" y1="${H - B}" y2="${H - B + 4}" class="ax"/>${i % every === 0 ? `<text x="${X(t.d) + 2}" y="${H - 8}">${MONTHS[t.m]}${t.m === 0 ? ` ${String(t.y).slice(2)}` : ''}</text>` : ''}`).join('');

  let soll = '';
  let marks = '';
  if (s.curve) {
    const pts = [...s.curve];
    if (pts[pts.length - 1][0] < x1) pts.push([x1, 1]);
    soll = `<polyline class="soll-l" points="${pts.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
    marks = p.milestones.map((m) => {
      const due = dayNum(m.due || p.due);
      if (!Number.isFinite(due)) return '';
      const dd = Math.max(due, x0);
      const cx = X(dd); const cy = Y(plannedAt(s.curve, dd));
      return `<path class="mk${milestoneComplete(m) ? ' done' : ''}" d="M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z"><title>${esc(m.title)} · ${formatDate(m.due || p.due)}</title></path>`;
    }).join('');
  }

  let ist = '';
  if (s.total) {
    const series = actualSeries(p, x0, Math.min(today, x1));
    if (series.length) {
      // Treppenlinie: der Wert gilt ab dem Tag, an dem er erreicht wurde.
      let d = `M${X(series[0][0]).toFixed(1)},${Y(series[0][1]).toFixed(1)}`;
      for (let i = 1; i < series.length; i += 1) {
        if (series[i][1] !== series[i - 1][1]) {
          d += ` H${X(series[i][0]).toFixed(1)} V${Y(series[i][1]).toFixed(1)}`;
        }
      }
      const last = series[series.length - 1];
      d += ` H${X(last[0]).toFixed(1)}`;
      const area = `${d} V${Y(0)} H${X(series[0][0]).toFixed(1)} Z`;
      ist = `<path class="ist-a" d="${area}"/><path class="ist-l" d="${d}"/>`;
      if (fcDay && fcDay <= x1 && !s.forecast.finished) {
        ist += `<line class="fc" x1="${X(last[0])}" y1="${Y(last[1])}" x2="${X(fcDay)}" y2="${Y(1)}"><title>Prognose: ${formatDate(fromDayNum(fcDay))}</title></line>`;
      }
    }
  }

  const tx = X(Math.min(today, x1));
  return `<figure class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fortschritt über die Zeit: Ist gegen Soll">
      ${grid}${xlab}
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ax"/>
      ${soll}${ist}${marks}
      <line class="today" x1="${tx}" x2="${tx}" y1="${T - 4}" y2="${H - B}"/>
      <text class="today-t" x="${tx}" y="${T - 2}" text-anchor="middle">heute</text>
    </svg>
    <figcaption class="legend">
      <span><i class="lg-ist"></i>Ist</span>
      ${s.curve ? '<span><i class="lg-soll"></i>Soll</span><span><i class="lg-mk"></i>Meilenstein</span>' : '<span class="muted">Kein Soll: Beginn oder Ziel fehlt.</span>'}
      ${fcDay && fcDay <= x1 && !s.forecast.finished ? '<span><i class="lg-fc"></i>Prognose</span>' : ''}
    </figcaption>
  </figure>`;
}

/* ------------------------------------------------------------------ */
/* Zeitleiste                                                          */
/* ------------------------------------------------------------------ */

export function renderTimeline(state, ui) {
  const today = dayNum(todayIso());
  const filter = FILTERS.find((f) => f.id === ui.filter) || FILTERS[0];
  const byStatus = state.projects.filter(filter.test);
  const all = sortProjects(byStatus.filter((p) => matchesTags(p, ui.tags)), 'faellig', today);
  const dated = all.filter((p) => Number.isFinite(dayNum(p.start)) && Number.isFinite(dayNum(p.due)));
  const undated = all.filter((p) => !dated.includes(p));

  const head = `<div class="toolbar">
    <div class="segmented small" role="group" aria-label="Filter">
      ${FILTERS.map((f) => `<button type="button" data-act="filter" data-id="${f.id}" aria-pressed="${f.id === filter.id}">${f.label}</button>`).join('')}
    </div>
  </div>${tagBar(byStatus, ui.tags)}`;

  if (!dated.length) {
    return `${head}<p class="muted empty-small">${all.length ? 'Für die Zeitleiste braucht ein Projekt Beginn und Ziel.' : 'Keine Projekte in dieser Auswahl.'}</p>${undatedList(undated)}`;
  }

  let x0 = Math.min(today, ...dated.map((p) => dayNum(p.start)));
  let x1 = Math.max(today, ...dated.map((p) => dayNum(p.due)));
  const pad = Math.max(3, Math.round((x1 - x0) * 0.02));
  x0 -= pad; x1 += pad;
  const P = (d) => `${(((d - x0) / (x1 - x0)) * 100).toFixed(3)}%`;

  const ticks = monthTicks(x0, x1);
  const every = Math.ceil(ticks.length / 10);
  const axis = ticks.map((t, i) => `<span class="tl-tick${i % every ? ' minor' : ''}" style="left:${P(t.d)}">${i % every ? '' : `${MONTHS[t.m]}${t.m === 0 || i === 0 ? ` ${t.y}` : ''}`}</span>`).join('');

  const rows = dated.map((p) => {
    const s = summarize(p, today);
    const a = dayNum(p.start); const b = dayNum(p.due);
    const ist = s.ist == null ? 0 : clamp01(s.ist);
    const ms = p.milestones.map((m) => {
      const d = dayNum(m.due);
      if (!Number.isFinite(d)) return '';
      return `<span class="tl-mk${milestoneComplete(m) ? ' done' : ''}" style="left:${P(d)}" title="${esc(m.title)} · ${formatDate(m.due)}"></span>`;
    }).join('');
    const lag = lagText(s);
    return `<div class="tl-row" style="--pc:${esc(p.color)}">
      <a class="tl-label" href="#/p/${esc(p.id)}" title="${esc(p.tags.map((t) => `#${t}`).join(' '))}"><strong>${esc(p.title)}</strong><span class="muted">${pct(s.ist)}${lag ? ` · <span class="${lag.cls}">${lag.text}</span>` : ''}</span></a>
      <div class="tl-track">
        <span class="tl-bar" style="left:${P(a)};width:calc(${P(b)} - ${P(a)})" title="${formatDate(p.start)} – ${formatDate(p.due)}">
          <span class="tl-fill" style="width:${(ist * 100).toFixed(2)}%"></span>
        </span>
        ${ms}
      </div>
    </div>`;
  }).join('');

  return `${head}<div class="timeline" style="--today:${P(today)}">
    <div class="tl-row tl-axis"><span class="tl-label"></span><div class="tl-track">${axis}</div></div>
    ${rows}
  </div>${undatedList(undated)}`;
}

function undatedList(list) {
  if (!list.length) return '';
  return `<div class="undated"><h2>Ohne Zeitraum</h2><ul>${list.map((p) => `<li><a href="#/p/${esc(p.id)}">${esc(p.title)}</a> <span class="muted">${summarize(p).ist != null ? `${pct(summarize(p).ist)} · ` : ''}${[p.start ? '' : 'Beginn', p.due ? '' : 'Ziel'].filter(Boolean).join(' und ')} fehlt</span></li>`).join('')}</ul></div>`;
}

/* ------------------------------------------------------------------ */
/* Dialog-Helfer                                                       */
/* ------------------------------------------------------------------ */

export function statusOptions(selected) {
  return STATUS.map((s) => `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${s.label}</option>`).join('');
}

export function colorSwatches(selected) {
  return COLORS.map((c) => `<button type="button" class="swatch" role="radio" aria-checked="${c === selected}" data-color="${c}" style="--c:${c}" aria-label="Farbe ${c}"></button>`).join('');
}
