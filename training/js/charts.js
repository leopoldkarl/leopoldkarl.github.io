// charts.js — kleine SVG-Diagrammbibliothek ohne Abhaengigkeiten.
//
// Gemeinsame Regeln: 2px-Linien, Balken <= 24px mit 4px runder Oberkante
// und 2px Flaechenluecke, Gitter als 1px-Haarlinie, ein Tooltip mit
// Fadenkreuz fuer Linien bzw. je Marke fuer Balken/Zellen. Farben kommen
// ausschliesslich als CSS-Variablen, damit Hell/Dunkel an einer Stelle
// wechselt. Beschriftungen werden per textContent gesetzt.

const NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k) e.append(k);
  return e;
}

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

// ------------------------------------------------------------------ Tooltip

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite' });
    document.body.append(tipEl);
  }
  return tipEl;
}

export function showTip(x, y, title, rows) {
  const t = tip();
  t.replaceChildren();
  if (title) t.append(h('div', { class: 'tt-title', text: title }));
  for (const r of rows) {
    t.append(h('div', { class: 'tt-row' },
      r.color ? h('span', { class: `tt-key ${r.shape || 'line'}`, style: { background: r.color } }) : h('span', { class: 'tt-key none' }),
      h('span', { class: 'tt-val', text: r.value }),
      h('span', { class: 'tt-lab', text: r.label || '' })));
  }
  t.style.display = 'block';
  const w = t.offsetWidth, hh = t.offsetHeight;
  const vw = document.documentElement.clientWidth;
  let left = x + 14, top = y + 14;
  if (left + w > vw - 8) left = x - w - 14;
  if (left < 8) left = 8;
  if (top + hh > window.innerHeight - 8) top = y - hh - 14;
  t.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

export function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

// ------------------------------------------------------------------ Hilfen

export function niceTicks(lo, hi, n = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return { ticks: out, step };
}

function extent(arrs, zero) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrs) for (const v of a) if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!isFinite(lo)) return [0, 1];
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (lo === hi) { lo -= 1; hi += 1; }
  return [lo, hi];
}

function bisect(xs, x) {
  let lo = 0, hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - x) < Math.abs(xs[lo] - x)) lo--;
  return lo;
}

function linePath(xs, ys, X, Y) {
  let d = '', pen = false;
  for (let i = 0; i < xs.length; i++) {
    const v = ys[i];
    if (v == null || !isFinite(v)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function areaPath(xs, ys, X, Y, base) {
  let d = '', run = [];
  const flush = () => {
    if (run.length > 1) {
      d += `M${X(xs[run[0]]).toFixed(1)},${Y(base).toFixed(1)}`;
      for (const i of run) d += `L${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`;
      d += `L${X(xs[run[run.length - 1]]).toFixed(1)},${Y(base).toFixed(1)}Z`;
    }
    run = [];
  };
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] == null || !isFinite(ys[i])) flush(); else run.push(i);
  }
  flush();
  return d;
}

// Neu zeichnen bei Groessenaenderung
export function responsive(host, draw) {
  let w = 0, raf = 0;
  const run = () => {
    const nw = host.clientWidth;
    if (nw && nw !== w) { w = nw; draw(nw); }
  };
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); });
  ro.observe(host);
  run();
  return () => ro.disconnect();
}

function legend(series, shape = 'line') {
  return h('div', { class: 'legend' }, series.map(sr =>
    h('span', { class: 'legend-item' },
      h('span', { class: `legend-key ${sr.shape || shape}`, style: { background: sr.color } }),
      h('span', { text: sr.label }))));
}

// ------------------------------------------------------------------ Linien (Panels mit gemeinsamer x-Achse)
//
// opts = {
//   x: number[], xTicks(lo, hi, width) -> [{v, label}], xFmt(v) -> string,
//   panels: [{ label, height, series: [{label, color, values, area, dash}], yFmt, zero, invert, domain, refLine }],
//   onHover(i | null), onSelect([i0, i1] | null), selectable
// }
export function lineChart(host, opts) {
  host.classList.add('chart');
  host.replaceChildren();
  const legendSeries = opts.panels.flatMap(p => p.series.length > 1 ? p.series : []);
  if (legendSeries.length) host.append(legend(legendSeries));
  const wrap = h('div', { class: 'chart-svg' });
  host.append(wrap);
  let api = { highlight() {}, clearSelection() {} };

  const cleanup = responsive(wrap, width => {
    wrap.replaceChildren();
    const m = { l: 52, r: 12, t: 8, b: 26 };
    const gap = 18;
    const heights = opts.panels.map(p => p.height || 120);
    const H = m.t + heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1) + m.b;
    const xs = opts.x;
    const [x0, x1] = opts.xDomain || [xs[0], xs[xs.length - 1]];
    const X = v => m.l + ((v - x0) / (x1 - x0 || 1)) * (width - m.l - m.r);
    const svg = s('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'svg' });
    wrap.append(svg);

    let top = m.t;
    const panelY = [];
    opts.panels.forEach((p, pi) => {
      const ph = heights[pi];
      let [lo, hi] = p.domain || extent(p.series.map(sr => sr.values), p.zero);
      if (!p.domain) { const pad = (hi - lo) * 0.06; hi += pad; if (!p.zero) lo -= pad; }
      const { ticks } = niceTicks(lo, hi, ph < 90 ? 2 : 4);
      const Y = v => {
        const c = Math.max(lo, Math.min(hi, v));
        const f = (c - lo) / (hi - lo || 1);
        return p.invert ? top + f * ph : top + ph - f * ph;
      };
      panelY.push({ top, ph, Y });
      const g = s('g', { class: 'panel' });
      for (const t of ticks) {
        if (t < lo || t > hi) continue;
        g.append(s('line', { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t), class: 'grid' }));
        g.append(s('text', { x: m.l - 6, y: Y(t) + 4, class: 'tick', 'text-anchor': 'end', text: p.yFmt ? p.yFmt(t) : t }));
      }
      if (p.refLine != null) g.append(s('line', { x1: m.l, x2: width - m.r, y1: Y(p.refLine), y2: Y(p.refLine), class: 'axis' }));
      g.append(s('text', { x: m.l, y: top - 1 + 10, class: 'panel-label', text: p.label }));
      for (const sr of p.series) {
        if (sr.bars) {
          const bw = Math.max(1, Math.min(24, (width - m.l - m.r) / xs.length - 1));
          const base = Y(Math.max(lo, 0));
          let d = '';
          sr.values.forEach((v, i) => {
            if (!v) return;
            const y = Y(v), x = X(xs[i]) - bw / 2;
            d += `M${x.toFixed(1)},${base.toFixed(1)}V${y.toFixed(1)}H${(x + bw).toFixed(1)}V${base.toFixed(1)}Z`;
          });
          g.append(s('path', { d, class: 'bar', style: { fill: sr.color } }));
          continue;
        }
        if (sr.area) {
          const base = p.refLine ?? (p.invert ? hi : lo);
          g.append(s('path', { d: areaPath(xs, sr.values, X, Y, base), class: 'area', style: { fill: sr.color } }));
        }
        g.append(s('path', { d: linePath(xs, sr.values, X, Y), class: `line${sr.thin ? ' thin' : ''}`, style: { stroke: sr.color } }));
      }
      svg.append(g);
      top += ph + gap;
    });

    // x-Achse
    const bottom = top - gap;
    const xt = opts.xTicks ? opts.xTicks(x0, x1, width) : niceTicks(x0, x1, Math.max(2, Math.floor(width / 110))).ticks.map(v => ({ v, label: opts.xFmt ? opts.xFmt(v) : v }));
    for (const t of xt) {
      const px = X(t.v);
      if (px < m.l - 1 || px > width - m.r + 1) continue;
      svg.append(s('text', { x: px, y: bottom + 18, class: 'tick', 'text-anchor': 'middle', text: t.label }));
    }
    svg.append(s('line', { x1: m.l, x2: width - m.r, y1: bottom + 1, y2: bottom + 1, class: 'axis' }));

    // Auswahl + Fadenkreuz
    const sel = s('rect', { y: m.t, height: bottom - m.t, class: 'selection', visibility: 'hidden' });
    const cross = s('line', { y1: m.t, y2: bottom, class: 'crosshair', visibility: 'hidden' });
    const dots = s('g');
    svg.append(sel, cross, dots);
    const hit = s('rect', { x: m.l, y: m.t, width: width - m.l - m.r, height: bottom - m.t, class: 'hit', tabindex: 0 });
    svg.append(hit);

    const toIndex = clientX => {
      const r = svg.getBoundingClientRect();
      const v = x0 + ((clientX - r.left - m.l) / (width - m.l - m.r)) * (x1 - x0);
      return bisect(xs, v);
    };
    const show = (i, cx, cy) => {
      if (i == null) { cross.setAttribute('visibility', 'hidden'); dots.replaceChildren(); hideTip(); opts.onHover?.(null); return; }
      const px = X(xs[i]);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      dots.replaceChildren();
      const rows = [];
      opts.panels.forEach((p, pi) => {
        for (const sr of p.series) {
          const v = sr.values[i];
          if (v != null && isFinite(v)) {
            dots.append(s('circle', { cx: px, cy: panelY[pi].Y(v), r: 4, class: 'dot', style: { fill: sr.color } }));
          }
          rows.push({ color: sr.color, value: v == null ? '–' : (sr.fmt || p.yFmt || String)(v), label: sr.label });
        }
      });
      if (cx != null) showTip(cx, cy, opts.xFmt ? opts.xFmt(xs[i]) : '', rows);
      opts.onHover?.(i);
    };
    let drag = null;
    hit.addEventListener('pointerdown', e => {
      if (!opts.selectable) return;
      drag = { i0: toIndex(e.clientX), x: e.clientX };
      hit.setPointerCapture(e.pointerId);
    });
    hit.addEventListener('pointermove', e => {
      const i = toIndex(e.clientX);
      if (drag && Math.abs(e.clientX - drag.x) > 4) {
        const a = Math.min(drag.i0, i), b = Math.max(drag.i0, i);
        sel.setAttribute('x', X(xs[a])); sel.setAttribute('width', Math.max(1, X(xs[b]) - X(xs[a])));
        sel.setAttribute('visibility', 'visible');
      }
      show(i, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerup', e => {
      if (!drag) return;
      const i = toIndex(e.clientX);
      if (Math.abs(e.clientX - drag.x) > 4) {
        opts.onSelect?.([Math.min(drag.i0, i), Math.max(drag.i0, i)]);
      } else {
        sel.setAttribute('visibility', 'hidden');
        opts.onSelect?.(null);
      }
      drag = null;
    });
    hit.addEventListener('pointerleave', () => { if (!drag) show(null); });
    let kbd = null;
    hit.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = Math.max(1, Math.round(xs.length / 100));
      kbd = Math.max(0, Math.min(xs.length - 1, (kbd ?? 0) + (e.key === 'ArrowRight' ? step : -step)));
      const r = svg.getBoundingClientRect();
      show(kbd, r.left + X(xs[kbd]), r.top + m.t);
    });
    hit.addEventListener('blur', () => show(null));
    api = {
      highlight(i) { if (i == null) show(null); else show(i); },
      clearSelection() { sel.setAttribute('visibility', 'hidden'); },
    };
  });
  return { destroy: cleanup, get api() { return api; } };
}

// ------------------------------------------------------------------ Saeulen (gestapelt)
//
// opts = { labels: string[], tickLabels?: string[], stacks: [{label, color, values}],
//          yFmt, height, onClick(i), title(i) }
export function barChart(host, opts) {
  host.classList.add('chart');
  host.replaceChildren();
  const active = opts.stacks.filter(st => st.values.some(v => v > 0));
  const tf = opts.tipFmt || opts.yFmt || String;
  if (active.length > 1) host.append(legend(active, 'rect'));
  const wrap = h('div', { class: 'chart-svg' });
  host.append(wrap);
  return responsive(wrap, width => {
    wrap.replaceChildren();
    const H = opts.height || 200;
    const m = { l: 44, r: 8, t: 10, b: 24 };
    const n = opts.labels.length;
    const totals = opts.labels.map((_, i) => active.reduce((a, st) => a + (st.values[i] || 0), 0));
    const maxV = Math.max(...totals, 0) || 1;
    const { ticks } = niceTicks(0, maxV, 4);
    const top = Math.max(maxV, ticks[ticks.length - 1]);
    const band = (width - m.l - m.r) / n;
    const bw = Math.max(2, Math.min(24, band - 2));
    const Y = v => H - m.b - (v / top) * (H - m.t - m.b);
    const svg = s('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'svg' });
    for (const t of ticks) {
      svg.append(s('line', { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t), class: 'grid' }));
      svg.append(s('text', { x: m.l - 6, y: Y(t) + 4, class: 'tick', 'text-anchor': 'end', text: opts.yFmt ? opts.yFmt(t) : t }));
    }
    const every = Math.ceil(n / Math.max(1, Math.floor((width - m.l) / 46)));
    for (let i = 0; i < n; i++) {
      const cx = m.l + band * (i + 0.5);
      const g = s('g', { class: 'bar-group', tabindex: 0 });
      let acc = 0;
      const segs = active.map(st => ({ st, v: st.values[i] || 0 })).filter(x => x.v > 0);
      segs.forEach((x, k) => {
        const y0 = Y(acc), y1 = Y(acc + x.v);
        acc += x.v;
        const last = k === segs.length - 1;
        const hgt = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
        if (hgt <= 0) return;
        const yTop = y1, yBot = y1 + hgt;
        const r = last ? Math.min(4, hgt, bw / 2) : 0;
        const x0 = cx - bw / 2, x1 = cx + bw / 2;
        const d = `M${x0},${yBot}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x1 - r}Q${x1},${yTop} ${x1},${yTop + r}V${yBot}Z`;
        g.append(s('path', { d, class: 'bar', style: { fill: x.st.color } }));
      });
      g.append(s('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, class: 'hit' }));
      const tipRows = () => [
        ...segs.slice().reverse().map(x => ({ color: x.st.color, shape: 'rect', value: tf(x.v), label: x.st.label })),
        ...(segs.length > 1 ? [{ value: tf(totals[i]), label: 'Summe' }] : []),
      ];
      const title = opts.title ? opts.title(i) : opts.labels[i];
      g.addEventListener('pointermove', e => { g.classList.add('hover'); showTip(e.clientX, e.clientY, title, tipRows().length ? tipRows() : [{ value: '0', label: '' }]); });
      g.addEventListener('pointerleave', () => { g.classList.remove('hover'); hideTip(); });
      g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); showTip(r.right, r.top, title, tipRows()); });
      g.addEventListener('blur', hideTip);
      if (opts.onClick) { g.style.cursor = 'pointer'; g.addEventListener('click', () => opts.onClick(i)); }
      svg.append(g);
      if (i % every === 0 && (opts.tickLabels?.[i] ?? opts.labels[i])) {
        svg.append(s('text', { x: cx, y: H - 6, class: 'tick', 'text-anchor': 'middle', text: opts.tickLabels?.[i] ?? opts.labels[i] }));
      }
    }
    svg.append(s('line', { x1: m.l, x2: width - m.r, y1: Y(0) + 0.5, y2: Y(0) + 0.5, class: 'axis' }));
    wrap.append(svg);
  });
}

// ------------------------------------------------------------------ Mean-Max-Kurven (log x)
//
// opts = { x: durations[], series: [{label, color, values, meta?: (i)->string, thin}], yFmt, xFmt, height, invert, onClick(seriesIdx, i) }
export function curveChart(host, opts) {
  host.classList.add('chart');
  host.replaceChildren();
  if (opts.series.length > 1) host.append(legend(opts.series));
  const wrap = h('div', { class: 'chart-svg' });
  host.append(wrap);
  return responsive(wrap, width => {
    wrap.replaceChildren();
    const H = opts.height || 260;
    const m = { l: 56, r: 12, t: 10, b: 26 };
    const xsAll = opts.x;
    const used = xsAll.map((_, i) => opts.series.some(sr => sr.values[i] != null));
    const iLast = used.lastIndexOf(true);
    const iFirst = Math.max(0, used.indexOf(true));
    if (iLast < 0) { wrap.append(h('p', { class: 'muted', text: 'Keine Daten.' })); return; }
    const lx0 = Math.log(xsAll[iFirst]), lx1 = Math.log(xsAll[iLast]);
    const X = v => m.l + ((Math.log(v) - lx0) / (lx1 - lx0 || 1)) * (width - m.l - m.r);
    let [lo, hi] = extent(opts.series.map(sr => sr.values));
    const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
    if (opts.domain) [lo, hi] = opts.domain;
    const { ticks } = niceTicks(lo, hi, 4);
    const Y = v => {
      const f = (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1);
      return opts.invert ? m.t + f * (H - m.t - m.b) : H - m.b - f * (H - m.t - m.b);
    };
    const svg = s('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'svg' });
    for (const t of ticks) {
      if (t < lo || t > hi) continue;
      svg.append(s('line', { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t), class: 'grid' }));
      svg.append(s('text', { x: m.l - 6, y: Y(t) + 4, class: 'tick', 'text-anchor': 'end', text: opts.yFmt(t) }));
    }
    const xt = [1, 5, 15, 60, 300, 1200, 3600, 7200, 18000].filter(v => v >= xsAll[iFirst] && v <= xsAll[iLast]);
    for (const v of xt) {
      svg.append(s('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: 'grid' }));
      svg.append(s('text', { x: X(v), y: H - 8, class: 'tick', 'text-anchor': 'middle', text: opts.xFmt(v) }));
    }
    const xs = xsAll.slice(iFirst, iLast + 1);
    for (const sr of opts.series.slice().reverse()) {
      const vals = sr.values.slice(iFirst, iLast + 1);
      svg.append(s('path', { d: linePath(xs, vals, X, Y), class: `line${sr.thin ? ' thin' : ''}`, style: { stroke: sr.color } }));
    }
    const cross = s('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' });
    const dots = s('g');
    const hit = s('rect', { x: m.l, y: m.t, width: width - m.l - m.r, height: H - m.t - m.b, class: 'hit', tabindex: 0 });
    svg.append(cross, dots, hit);
    let cur = null;
    const show = (i, cx, cy) => {
      cur = i;
      const px = X(xsAll[i]);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      dots.replaceChildren();
      const rows = opts.series.map(sr => {
        const v = sr.values[i];
        if (v != null) dots.append(s('circle', { cx: px, cy: Y(v), r: 4, class: 'dot', style: { fill: sr.color } }));
        return { color: sr.color, value: v == null ? '–' : opts.yFmt(v), label: sr.meta ? `${sr.label} · ${sr.meta(i) || ''}` : sr.label };
      });
      showTip(cx, cy, opts.xFmt(xsAll[i]), rows);
    };
    hit.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      const lv = lx0 + ((e.clientX - r.left - m.l) / (width - m.l - m.r)) * (lx1 - lx0);
      let best = iFirst, bd = Infinity;
      for (let i = iFirst; i <= iLast; i++) { const d = Math.abs(Math.log(xsAll[i]) - lv); if (d < bd) { bd = d; best = i; } }
      show(best, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dots.replaceChildren(); hideTip(); cur = null; });
    hit.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = Math.max(iFirst, Math.min(iLast, (cur ?? iFirst - 1) + (e.key === 'ArrowRight' ? 1 : -1)));
      const r = svg.getBoundingClientRect();
      show(i, r.left + X(xsAll[i]), r.top + m.t);
    });
    if (opts.onClick) {
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', () => { if (cur != null) opts.onClick(cur); });
    }
    wrap.append(svg);
  });
}

// ------------------------------------------------------------------ Kalender-Heatmap
//
// opts = { start: Date (Montag), weeks, value(dayKey) -> number, max, title(date) , rows(date) -> tipRows, onClick(date) }
export function heatmap(host, opts) {
  host.classList.add('chart');
  host.replaceChildren();
  const wrap = h('div', { class: 'chart-svg' });
  host.append(wrap);
  return responsive(wrap, width => {
    wrap.replaceChildren();
    const m = { l: 22, t: 16 };
    const cell = Math.max(6, Math.min(16, Math.floor((width - m.l) / opts.weeks) - 2));
    const H = m.t + 7 * (cell + 2) + 4;
    const svg = s('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'svg' });
    ['Mo', '', 'Mi', '', 'Fr', '', ''].forEach((l, i) => l && svg.append(s('text', { x: 0, y: m.t + i * (cell + 2) + cell - 1, class: 'tick', text: l })));
    const steps = [0.08, 0.3, 0.55, 0.8];          // Grenzen relativ zu max
    let lastMonth = -1;
    const today = new Date();
    for (let w = 0; w < opts.weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(opts.start.getFullYear(), opts.start.getMonth(), opts.start.getDate() + w * 7 + d);
        if (date > today) continue;
        const x = m.l + w * (cell + 2), y = m.t + d * (cell + 2);
        if (d === 0 && date.getMonth() !== lastMonth && date.getDate() <= 7) {
          lastMonth = date.getMonth();
          svg.append(s('text', { x, y: 10, class: 'tick', text: opts.monthLabel(date) }));
        }
        const v = opts.value(date);
        let lvl = 0;
        if (v > 0) { lvl = 1; for (const st of steps) if (v / opts.max > st) lvl++; lvl = Math.min(lvl, 4); }
        const r = s('rect', { x, y, width: cell, height: cell, rx: 2, class: `cell l${lvl}`, tabindex: v > 0 ? 0 : null });
        const tipIt = (cx, cy) => showTip(cx, cy, opts.title(date), opts.rows(date));
        r.addEventListener('pointermove', e => tipIt(e.clientX, e.clientY));
        r.addEventListener('pointerleave', hideTip);
        r.addEventListener('focus', () => { const b = r.getBoundingClientRect(); tipIt(b.right, b.bottom); });
        r.addEventListener('blur', hideTip);
        if (v > 0 && opts.onClick) { r.style.cursor = 'pointer'; r.addEventListener('click', () => opts.onClick(date)); }
        svg.append(r);
      }
    }
    wrap.append(svg);
  });
}

// ------------------------------------------------------------------ Zonenbalken (HTML)
//
// zones: [{label, range, seconds}], color(i) -> css color
export function zoneBars(host, zones, color, fmt) {
  const total = zones.reduce((a, z) => a + z.seconds, 0) || 1;
  const max = Math.max(...zones.map(z => z.seconds), 1);
  host.replaceChildren(h('div', { class: 'zones' }, zones.map((z, i) =>
    h('div', { class: 'zone-row' },
      h('div', { class: 'zone-label' }, h('span', { text: z.label }), h('span', { class: 'muted', text: z.range })),
      h('div', { class: 'zone-track' }, h('div', { class: 'zone-fill', style: { width: `${(z.seconds / max) * 100}%`, background: color(i) } })),
      h('div', { class: 'zone-val' }, h('span', { text: fmt(z.seconds) }), h('span', { class: 'muted', text: `${Math.round((z.seconds / total) * 100)} %` }))))));
}
