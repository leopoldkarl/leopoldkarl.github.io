// views.js — reine Render-Funktionen (Zustand -> HTML-Text) plus Diagramm-Hover.

import {
  KINDS, KIND_LABEL, money, formatDate, formatMonth, todayIso, dayNum, fromDayNum,
  rateAt, toEur, totalEur, balancesAt, series, months, byTitle, yearsOf, MONTHS, sortEntries,
} from './model.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const accName = (s, id) => { const a = s.accounts.find((x) => x.id === id); return a ? a.name : '?'; };
const accOf = (s, id) => s.accounts.find((x) => x.id === id);
const sw = (a) => `<i class="sw" style="--c: var(--s${a.slot + 1})"></i>`;
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const fmtRate = (r) => (r ? r.toLocaleString('de-AT', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '–');

/* ------------------------------------------------------------------ */
/* Übersicht                                                           */
/* ------------------------------------------------------------------ */

export function renderEmpty() {
  return `
  <section class="empty">
    <h2>Noch keine Konten</h2>
    <p class="muted">Lege deine Konten an oder spiele eine Exportdatei ein (Menü ⋯ → Import).</p>
    <p><button class="primary" data-act="default-accounts">Konten wie in EAR.xlsx anlegen</button>
       <button data-act="goto-accounts">Konten selbst anlegen</button></p>
    <p class="hint">Vorschlag: Konto AT, Bundesschatz, Konto CH, Sparkonto CH, Bargeld, Flatex-Depot.</p>
  </section>`;
}

export function renderOverview(s, ui, led) {
  if (!s.accounts.length) return renderEmpty();
  const today = todayIso();
  const rateNow = rateAt(s.rates, today);
  const lastRate = s.rates[s.rates.length - 1];
  const bal = led.balances;
  const tot = totalEur(s, bal, rateNow);

  const compare = (date, label) => {
    if (!led.rows.length || led.rows[0].e.date > date) return '';
    const b = balancesAt(s, date, led);
    const t = totalEur(s, b, rateAt(s.rates, date));
    const d = tot.sum - t.sum;
    return `<span class="${cls(d)}">${money(d, 'EUR', { sign: true })}</span> <span class="muted">${label}</span>`;
  };
  const y0 = `${Number(today.slice(0, 4)) - 1}-12-31`;
  const d30 = fromDayNum(dayNum(today) - 30);
  const lastDate = led.rows.length ? led.rows[led.rows.length - 1].e.date : null;

  const cards = s.accounts.filter((a) => !a.archived || (bal.get(a.id) || 0) !== 0).map((a) => {
    const v = bal.get(a.id) || 0;
    const eur = a.currency === 'CHF' ? toEur(v, 'CHF', rateNow) : null;
    let lastStand = null;
    for (const r of led.rows) if (r.e.type === 'stand' && r.effects.some((f) => f.acc === a.id)) lastStand = r.e.date;
    return `
    <a class="acc card" href="#/buchungen?konto=${esc(a.id)}" style="--c: var(--s${a.slot + 1})">
      <span class="acc-kind">${sw(a)}${esc(KIND_LABEL[a.kind])} · ${a.currency}</span>
      <strong class="acc-name">${esc(a.name)}</strong>
      <span class="acc-bal ${v < 0 ? 'neg' : ''}">${money(v, a.currency)}</span>
      <span class="acc-sub muted">${[eur != null ? `≈ ${Number.isNaN(eur) ? 'Kurs fehlt' : money(eur)}` : '', lastStand ? `Stand geprüft ${formatDate(lastStand)}` : ''].filter(Boolean).join(' · ') || '&nbsp;'}</span>
    </a>`;
  }).join('');

  const ms = months(s, led).slice(-12).reverse();
  const monthRows = ms.map((m) => `
    <tr>
      <th scope="row">${formatMonth(m.ym, true)}</th>
      <td class="num pos">${m.income ? money(m.income) : ''}</td>
      <td class="num neg">${m.expense ? money(-m.expense) : ''}</td>
      <td class="num ${cls(m.valuation + m.opening)}">${m.opening ? `<span title="Anfangsbestände">${money(m.opening, 'EUR', { sign: true })}*</span>` : ''}${m.valuation ? `${m.opening ? '<br>' : ''}${money(m.valuation, 'EUR', { sign: true })}` : ''}</td>
      <td class="num ${cls(m.fx)} muted">${Math.abs(m.fx) >= 1 ? money(m.fx, 'EUR', { sign: true }) : ''}</td>
      <td class="num strong">${money(m.end)}${m.missing ? ' <span class="warn-t" title="Für CHF fehlt ein Kurs">!</span>' : ''}</td>
    </tr>`).join('');

  return `
  <section class="hero">
    <div>
      <span class="k">Gesamtvermögen</span>
      <span class="hero-v">${money(tot.sum)}</span>
      ${tot.missing ? '<p class="warn-t">Für CHF-Konten fehlt ein Wechselkurs (Konten → Kurse).</p>' : ''}
    </div>
    <dl class="hero-facts">
      <div><dt>Seit Jahresbeginn</dt><dd>${compare(y0, '') || '–'}</dd></div>
      <div><dt>Letzte 30 Tage</dt><dd>${compare(d30, '') || '–'}</dd></div>
      <div><dt>Letzter Eintrag</dt><dd>${lastDate ? formatDate(lastDate) : '–'}</dd></div>
      <div><dt>Kurs EUR/CHF</dt><dd>${lastRate ? `${fmtRate(lastRate.chfPerEur)} <span class="muted">(${formatDate(lastRate.date)})</span>` : '<a href="#/konten">fehlt</a>'}</dd></div>
    </dl>
  </section>

  <section class="accs">${cards}</section>

  ${renderChart(s, ui, led)}

  <section>
    <div class="sec-head"><h2>Monate</h2><span class="grow"></span><a href="#/auswertung" class="small">Auswertung nach Titel →</a></div>
    ${ms.length ? `
    <div class="tbl-wrap card">
      <table class="tbl months">
        <thead><tr><th>Monat</th><th class="num">Einnahmen</th><th class="num">Ausgaben</th><th class="num" title="Abweichungen aus Kontostand-Feststellungen, z. B. Kursentwicklung des Depots">Bewertung</th><th class="num" title="Wechselkurseffekt auf CHF-Bestände und Rundung">Kurs</th><th class="num">Vermögen Monatsende</th></tr></thead>
        <tbody>${monthRows}</tbody>
      </table>
    </div>
    <p class="hint">Alles in EUR zum Kurs des jeweiligen Tages. Umbuchungen zählen nicht als Einnahme/Ausgabe. * Anfangsbestand (erste Feststellung eines Kontos).</p>` : '<p class="muted">Noch keine Einträge.</p>'}
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Diagramm: gestapelte Flächen je Konto (EUR), Summe als Linie        */
/* ------------------------------------------------------------------ */

let chartData = null;   // für den Hover

export function renderChart(s, ui, led) {
  const pts = series(s, led);
  if (pts.length < 1) return '';
  const accs = s.accounts.filter((a) => pts.some((p) => p.values[a.id]));
  const W = Math.max(300, ui.chartW || 900);
  const H = W < 520 ? 220 : 280;
  const m = { l: W < 520 ? 44 : 64, r: 12, t: 12, b: 26 };
  const x0 = dayNum(pts[0].date);
  const x1 = Math.max(dayNum(todayIso()), dayNum(pts[pts.length - 1].date), x0 + 1);
  let yMax = 0;
  for (const p of pts) {
    let pos = 0;
    for (const a of accs) pos += Math.max(0, p.values[a.id]);
    yMax = Math.max(yMax, pos, p.total);
  }
  yMax = niceMax(yMax || 100);
  const X = (d) => m.l + ((d - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - v / yMax) * (H - m.t - m.b);

  // Stufenverlauf: Wert gilt bis zum nächsten Eintrag.
  const xs = pts.map((p) => X(dayNum(p.date)));
  xs.push(X(x1));
  const areas = [];
  const base = pts.map(() => 0);
  for (const a of accs) {
    const top = pts.map((p, i) => base[i] + Math.max(0, p.values[a.id]));
    let d = '';
    for (let i = 0; i < pts.length; i += 1) {
      d += `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${Y(top[i]).toFixed(1)}L${xs[i + 1].toFixed(1)},${Y(top[i]).toFixed(1)}`;
    }
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      d += `L${xs[i + 1].toFixed(1)},${Y(base[i]).toFixed(1)}L${xs[i].toFixed(1)},${Y(base[i]).toFixed(1)}`;
    }
    areas.push(`<path class="area" d="${d}Z" style="--c: var(--s${a.slot + 1})"/>`);
    for (let i = 0; i < pts.length; i += 1) base[i] = top[i];
  }
  let line = '';
  for (let i = 0; i < pts.length; i += 1) {
    line += `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${Y(pts[i].total).toFixed(1)}L${xs[i + 1].toFixed(1)},${Y(pts[i].total).toFixed(1)}`;
  }

  const ticks = [];
  for (let k = 0; k <= 4; k += 1) {
    const v = (yMax * k) / 4;
    ticks.push(`<line class="g" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${shortMoney(v)}</text>`);
  }
  const xt = timeTicks(x0, x1, W).map((t) => `<text x="${X(t.d)}" y="${H - 8}" text-anchor="middle">${esc(t.label)}</text>`).join('');

  chartData = { pts, accs, xs, W, H, m, X, Y, x0, x1 };

  const legend = accs.map((a) => `<span>${sw(a)}${esc(a.name)}</span>`).join('');
  return `
  <section class="chart card" aria-label="Verlauf des Vermögens">
    <div class="chart-head"><h2>Verlauf</h2><span class="muted small">in EUR, gestapelt je Konto</span></div>
    <div class="chart-box">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gesamtvermögen über die Zeit">
        ${ticks.join('')}
        ${areas.join('')}
        <path class="total" d="${line}"/>
        <line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>
        ${xt}
        <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
        <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
      </svg>
      <div class="tip" hidden></div>
    </div>
    <div class="legend"><span><i class="ln"></i>Summe</span>${legend}</div>
  </section>`;
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= v) return f * p;
  return 10 * p;
}
function shortMoney(c) {
  const e = c / 100;
  if (Math.abs(e) >= 1000) return `${(e / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k`;
  return e.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}
function timeTicks(x0, x1, W) {
  const span = x1 - x0;
  const out = [];
  const a = new Date(x0 * 864e5);
  let y = a.getUTCFullYear();
  let mo = a.getUTCMonth() + 1;
  const step = span > 1100 ? 12 : span > 400 ? 3 : span > 120 ? 1 : 1;
  const maxTicks = Math.max(2, Math.floor(W / 80));
  const cand = [];
  for (let i = 0; i < 400; i += 1) {
    const d = Math.round(Date.UTC(y, mo - 1, 1) / 864e5);
    if (d > x1) break;
    if (d >= x0 && (mo - 1) % step === 0) cand.push({ d, label: step === 12 ? String(y) : `${MONTHS[mo - 1]} ${String(y).slice(2)}` });
    mo += 1; if (mo > 12) { mo = 1; y += 1; }
  }
  const every = Math.ceil(cand.length / maxTicks) || 1;
  cand.forEach((c, i) => { if (i % every === 0) out.push(c); });
  if (!out.length) out.push({ d: x0, label: formatDate(fromDayNum(x0)) });
  return out;
}

/** Hover: Fadenkreuz + Tooltip mit allen Konten zum Tag unter dem Zeiger. */
export function attachChartHover(root) {
  const box = root.querySelector('.chart-box');
  if (!box || !chartData) return;
  const svg = box.querySelector('svg');
  const tip = box.querySelector('.tip');
  const cross = svg.querySelector('.cross');
  const d = chartData;
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * d.W;
    let i = -1;
    for (let k = 0; k < d.pts.length; k += 1) if (d.xs[k] <= px + 0.5) i = k;
    if (i < 0) { hide(); return; }
    const p = d.pts[i];
    cross.setAttribute('x1', px); cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    const rows = d.accs.filter((a) => p.values[a.id]).map((a) => `<tr><td>${sw(a)}${esc(a.name)}</td><td class="num">${money(p.values[a.id])}</td></tr>`).join('');
    tip.innerHTML = `<strong>${formatDate(p.date)}</strong><table>${rows}<tr class="sum"><td>Summe</td><td class="num">${money(p.total)}</td></tr></table>`;
    tip.hidden = false;
    const bx = (px / d.W) * r.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, bx + 12 + tw > r.width ? bx - tw - 12 : bx + 12), r.width - tw - 4)}px`;
    tip.style.top = '8px';
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}

/* ------------------------------------------------------------------ */
/* Buchungen                                                           */
/* ------------------------------------------------------------------ */

export const PAGE = 200;

export function renderJournal(s, ui, led, q) {
  if (!s.accounts.length) return renderEmpty();
  const acc = q.konto && accOf(s, q.konto) ? q.konto : '';
  const year = q.jahr || '';
  const text = (q.suche || '').trim().toLocaleLowerCase('de');
  const years = yearsOf(s);

  let rows = led.rows.slice().reverse();
  if (acc) rows = rows.filter((r) => r.effects.some((f) => f.acc === acc));
  if (year) rows = rows.filter((r) => r.e.date.startsWith(year));
  if (text) rows = rows.filter((r) => `${r.e.title} ${r.e.details}`.toLocaleLowerCase('de').includes(text));
  const total = rows.length;
  const shown = rows.slice(0, ui.journalLimit || PAGE);

  const a = acc ? accOf(s, acc) : null;
  const body = shown.map((r) => {
    const e = r.e;
    const eff = (acc ? r.effects.filter((f) => f.acc === acc) : r.effects);
    const amounts = eff.map((f) => {
      const ac = accOf(s, f.acc);
      const cur = ac ? ac.currency : 'EUR';
      if (e.type === 'stand') {
        const note = f.opening ? 'Anfangsbestand' : (f.delta ? `Abw. ${money(f.delta, cur, { sign: true })}` : 'stimmt');
        return `<div class="amt">${acc ? '' : `<span class="an">${sw(ac)}${esc(ac.name)}</span>`}<span>= ${money(f.after, cur)}</span><span class="muted small ${f.opening ? '' : cls(f.delta)}">${note}</span></div>`;
      }
      return `<div class="amt">${acc ? '' : `<span class="an">${sw(ac)}${esc(ac.name)}</span>`}<span class="${cls(f.delta)}">${money(f.delta, cur, { sign: true })}</span></div>`;
    }).join('');
    const saldo = a ? `<td class="num muted">${money(eff.length ? eff[eff.length - 1].after : 0, a.currency)}</td>` : '';
    const typeLabel = { umbuchung: 'Umbuchung', stand: 'Kontostand' }[e.type];
    const badge = typeLabel && e.title !== typeLabel ? `<span class="chip">${typeLabel}</span>` : '';
    return `
    <tr data-eid="${esc(e.id)}" tabindex="0">
      <td class="date">${formatDate(e.date)}</td>
      <td class="desc"><strong>${esc(e.title) || '<span class="muted">(ohne Titel)</span>'}</strong> ${badge}${e.details ? `<div class="muted small">${esc(e.details)}</div>` : ''}</td>
      <td class="num amts">${amounts}</td>
      ${saldo}
    </tr>`;
  }).join('');

  const accOpts = [`<option value="">Alle Konten</option>`, ...s.accounts.map((x) => `<option value="${esc(x.id)}" ${x.id === acc ? 'selected' : ''}>${esc(x.name)}${x.archived ? ' (archiviert)' : ''}</option>`)].join('');
  const yearOpts = [`<option value="">Alle Jahre</option>`, ...years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`)].join('');

  return `
  <div class="toolbar">
    <select data-act="f-konto" aria-label="Konto">${accOpts}</select>
    <select data-act="f-jahr" aria-label="Jahr">${yearOpts}</select>
    <input type="search" data-act="f-suche" data-fk="suche" placeholder="Suche in Titel und Details" value="${esc(q.suche || '')}" aria-label="Suche" />
    <span class="summary muted">${total} Eintr${total === 1 ? 'ag' : 'äge'}${a ? ` · Saldo ${money(led.balances.get(a.id) || 0, a.currency)}` : ''}</span>
  </div>
  ${total ? `
  <div class="tbl-wrap card">
    <table class="tbl journal">
      <thead><tr><th>Datum</th><th>Titel</th><th class="num">Betrag</th>${a ? '<th class="num">Saldo</th>' : ''}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  ${total > shown.length ? `<p class="more"><button data-act="more">Weitere ${Math.min(PAGE, total - shown.length)} anzeigen</button> <span class="muted small">(${total - shown.length} ältere)</span></p>` : ''}
  ` : '<p class="muted empty-small">Keine Einträge für diese Auswahl.</p>'}`;
}

/* ------------------------------------------------------------------ */
/* Auswertung                                                          */
/* ------------------------------------------------------------------ */

export function renderAnalysis(s, ui, led, q) {
  if (!s.accounts.length) return renderEmpty();
  const years = yearsOf(s);
  const year = q.jahr && years.includes(q.jahr) ? q.jahr : (years[0] || todayIso().slice(0, 4));
  const table = (sign, label) => {
    const t = byTitle(s, year, sign, led);
    if (!t.rows.length) return `<h2>${label}</h2><p class="muted">Keine ${label.toLowerCase()} ${year}.</p>`;
    const head = MONTHS.map((m) => `<th class="num">${m}</th>`).join('');
    const rows = t.rows.map((r) => `<tr><th scope="row"><a href="#/buchungen?jahr=${year}&suche=${encodeURIComponent(r.title === '(ohne Titel)' ? '' : r.title)}">${esc(r.title)}</a></th>${r.byMonth.map((v) => `<td class="num">${v ? plainEur(v) : ''}</td>`).join('')}<td class="num strong">${plainEur(r.sum)}</td><td class="num muted">${Math.round((r.sum / t.sum) * 100)} %</td></tr>`).join('');
    return `
    <h2>${label} <span class="muted small">${money(t.sum)}</span></h2>
    <div class="tbl-wrap card">
      <table class="tbl analysis">
        <thead><tr><th>Titel</th>${head}<th class="num">Summe</th><th class="num">Anteil</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th>Summe</th>${t.totals.map((v) => `<td class="num">${v ? plainEur(v) : ''}</td>`).join('')}<td class="num strong">${plainEur(t.sum)}</td><td></td></tr></tfoot>
      </table>
    </div>`;
  };
  return `
  <div class="toolbar">
    <nav class="segmented small" aria-label="Jahr">${(years.length ? years : [year]).map((y) => `<a href="#/auswertung?jahr=${y}" ${y === year ? 'aria-current="page"' : ''}>${y}</a>`).join('')}</nav>
    <span class="summary muted">Buchungen nach Titel, in EUR (ohne Umbuchungen und Kontostände)</span>
  </div>
  <section class="analysis-sec">${table(-1, 'Ausgaben')}</section>
  <section class="analysis-sec">${table(1, 'Einnahmen')}</section>`;
}

const plainEur = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------------ */
/* Konten und Kurse                                                    */
/* ------------------------------------------------------------------ */

export function renderAccounts(s, led) {
  const list = s.accounts.map((a, i) => `
    <li class="acc-row ${a.archived ? 'archived' : ''}" data-aid="${esc(a.id)}">
      ${sw(a)}
      <span class="grow"><strong>${esc(a.name)}</strong> <span class="muted small">${esc(KIND_LABEL[a.kind])} · ${a.currency}${a.archived ? ' · archiviert' : ''}</span></span>
      <span class="num">${money(led.balances.get(a.id) || 0, a.currency)}</span>
      <span class="mv">
        <button class="icon" data-act="acc-up" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">↑</button>
        <button class="icon" data-act="acc-down" ${i === s.accounts.length - 1 ? 'disabled' : ''} aria-label="nach unten">↓</button>
        <button data-act="acc-edit">Bearbeiten</button>
      </span>
    </li>`).join('');
  const rates = s.rates.slice().reverse().map((r) => `
    <li class="rate-row" data-date="${r.date}">
      <span class="date">${formatDate(r.date)}</span>
      <span class="grow">1 EUR = <strong>${fmtRate(r.chfPerEur)}</strong> CHF <span class="muted small">(1 CHF = ${fmtRate(1 / r.chfPerEur)} EUR)</span>${r.src === 'oenb' ? ' <span class="chip" title="Referenzkurs der EZB, automatisch aus dem OeNB-Webservice">OeNB</span>' : ''}</span>
      <button class="icon del" data-act="rate-del" aria-label="Kurs löschen">✕</button>
    </li>`).join('');
  return `
  <section>
    <div class="sec-head"><h2>Konten</h2><span class="grow"></span><button data-act="acc-new">+ Konto</button></div>
    ${s.accounts.length ? `<ul class="plain card">${list}</ul>` : `<p class="muted">Noch keine Konten. <button data-act="default-accounts">Konten wie in EAR.xlsx anlegen</button></p>`}
    <p class="hint">Ein Konto mit Einträgen lässt sich nicht löschen, nur archivieren (es verschwindet dann aus Auswahllisten, seine Geschichte bleibt).</p>
  </section>
  <section>
    <div class="sec-head"><h2>Wechselkurse</h2><span class="grow"></span><button data-act="rate-new">+ Kurs</button></div>
    ${s.rates.length ? `<ul class="plain card">${rates}</ul>` : '<p class="muted">Noch kein Kurs. Ohne Kurs werden CHF-Konten nicht in EUR umgerechnet.</p>'}
    <p class="hint">Es gilt jeweils der letzte Kurs am oder vor dem Tag; vor dem ersten Kurs der erste. Notierung wie am Markt: 1 EUR = x CHF. Einmal je Woche kommt der Referenzkurs der EZB aus dem OeNB-Webservice automatisch dazu (Kennzeichen „OeNB“); ein eigener Kurs am selben Tag hat Vorrang, ein gelöschter OeNB-Kurs kommt nicht wieder.</p>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Dialog-Teile                                                        */
/* ------------------------------------------------------------------ */

export function accountOptions(s, selected, { includeArchived = false } = {}) {
  return s.accounts
    .filter((a) => includeArchived || !a.archived || a.id === selected)
    .map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('');
}

export function kindOptions(sel) {
  return KINDS.map((k) => `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${k.label}</option>`).join('');
}

/** Kontostand-Formular: eine Zeile je aktivem Konto, Platzhalter = fortgeschriebener Saldo. */
export function standRows(s, computed, values) {
  return s.accounts.filter((a) => !a.archived || values[a.id] != null).map((a) => `
    <div class="stand-row">
      <label for="st-${esc(a.id)}">${sw(a)}${esc(a.name)} <span class="muted small">${a.currency}</span></label>
      <input id="st-${esc(a.id)}" data-acc="${esc(a.id)}" type="text" inputmode="decimal" autocomplete="off"
             placeholder="${esc(money(computed.get(a.id) || 0, a.currency))}" value="${esc(values[a.id] ?? '')}" />
    </div>`).join('');
}

export { sortEntries, accName };
