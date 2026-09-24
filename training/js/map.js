// map.js — Routenkarte aus OpenStreetMap-Kacheln + SVG-Linie, ohne Bibliothek.
// Web-Mercator, Zoom per Knopf/Mausrad, Verschieben per Ziehen.

import { h, s } from './charts.js';

const TILE = 256;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

function project(lat, lon, z) {
  const n = TILE * 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

// pts: [[lat, lon] | null, ...]  (null trennt Abschnitte, z.B. Privatzonen)
export function routeMap(host, pts, { color = 'var(--c-route)' } = {}) {
  host.classList.add('map');
  host.replaceChildren();
  const valid = pts.filter(Boolean);
  if (valid.length < 2) { host.append(h('p', { class: 'muted', text: 'Keine GPS-Daten.' })); return null; }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [la, lo] of valid) {
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo);
  }
  const tiles = h('div', { class: 'map-tiles' });
  const svg = s('svg', { class: 'map-svg' });
  const path = s('path', { class: 'map-route', style: { stroke: color } });
  const start = s('circle', { r: 5, class: 'map-start' });
  const end = s('circle', { r: 5, class: 'map-end' });
  const marker = s('circle', { r: 6, class: 'map-marker', visibility: 'hidden' });
  const hl = s('path', { class: 'map-route-hl' });
  svg.append(path, hl, start, end, marker);
  const zin = h('button', { class: 'map-btn', 'aria-label': 'Hineinzoomen', text: '+' });
  const zout = h('button', { class: 'map-btn', 'aria-label': 'Herauszoomen', text: '−' });
  const attr = h('div', { class: 'map-attr' }, '© ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }), '-Mitwirkende');
  host.append(tiles, svg, h('div', { class: 'map-ctrl' }, zin, zout), attr);

  let z = 0, cx = 0, cy = 0, W = 0, H = 0;       // Mittelpunkt in Pixeln bei Zoom z
  let hlRange = null, markIdx = null, P = null;

  function fit() {
    W = host.clientWidth; H = host.clientHeight;
    for (z = 18; z > 1; z--) {
      const [x0, y0] = project(maxLat, minLon, z);
      const [x1, y1] = project(minLat, maxLon, z);
      if (x1 - x0 < W * 0.85 && y1 - y0 < H * 0.85) break;
    }
    const [x0, y0] = project(maxLat, minLon, z);
    const [x1, y1] = project(minLat, maxLon, z);
    cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
  }

  function draw() {
    W = host.clientWidth; H = host.clientHeight;
    const ox = cx - W / 2, oy = cy - H / 2;
    // Kacheln
    const n = 2 ** z;
    const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE);
    const tx1 = Math.floor((ox + W) / TILE), ty1 = Math.floor((oy + H) / TILE);
    const want = new Set();
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        const id = `${z}/${wx}/${ty}`;
        want.add(id);
        let img = tiles.querySelector(`img[data-id="${id}"]`);
        if (!img) {
          img = h('img', { alt: '', draggable: 'false', 'data-id': id, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' });
          img.onerror = () => { img.style.visibility = 'hidden'; };
          img.src = TILE_URL(z, wx, ty);
          tiles.append(img);
        }
        img.style.transform = `translate(${tx * TILE - ox}px, ${ty * TILE - oy}px)`;
      }
    }
    for (const img of [...tiles.children]) if (!want.has(img.dataset.id)) img.remove();
    // Route
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    P = p => { const [x, y] = project(p[0], p[1], z); return [x - ox, y - oy]; };
    const dpath = (i0, i1) => {
      let d = '', pen = false;
      for (let i = i0; i <= i1; i++) {
        const p = pts[i];
        if (!p) { pen = false; continue; }
        const [x, y] = P(p);
        d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    path.setAttribute('d', dpath(0, pts.length - 1));
    hl.setAttribute('d', hlRange ? dpath(hlRange[0], hlRange[1]) : '');
    const first = pts.findIndex(Boolean), last = pts.length - 1 - [...pts].reverse().findIndex(Boolean);
    const [sx, sy] = P(pts[first]); start.setAttribute('cx', sx); start.setAttribute('cy', sy);
    const [ex, ey] = P(pts[last]); end.setAttribute('cx', ex); end.setAttribute('cy', ey);
    placeMarker();
  }

  function placeMarker() {
    if (markIdx != null && pts[markIdx] && P) {
      const [mx, my] = P(pts[markIdx]);
      marker.setAttribute('cx', mx); marker.setAttribute('cy', my); marker.setAttribute('visibility', 'visible');
    } else marker.setAttribute('visibility', 'hidden');
  }

  function zoom(dz, px = W / 2, py = H / 2) {
    const nz = Math.max(2, Math.min(18, z + dz));
    if (nz === z) return;
    const f = 2 ** (nz - z);
    const wx = cx - W / 2 + px, wy = cy - H / 2 + py;
    cx = wx * f - px + W / 2; cy = wy * f - py + H / 2;
    z = nz;
    tiles.replaceChildren();
    draw();
  }
  zin.addEventListener('click', () => zoom(1));
  zout.addEventListener('click', () => zoom(-1));
  host.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;           // Seite scrollt normal weiter
    e.preventDefault();
    const r = host.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  host.addEventListener('pointerdown', e => {
    if (e.target.closest('.map-btn, a')) return;
    drag = { x: e.clientX, y: e.clientY, cx, cy };
    host.setPointerCapture(e.pointerId);
    host.classList.add('dragging');
  });
  host.addEventListener('pointermove', e => {
    if (!drag) return;
    cx = drag.cx - (e.clientX - drag.x); cy = drag.cy - (e.clientY - drag.y);
    draw();
  });
  const endDrag = () => { drag = null; host.classList.remove('dragging'); };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);

  const ro = new ResizeObserver(() => { if (host.clientWidth && host.clientWidth !== W) { fit(); tiles.replaceChildren(); draw(); } });
  ro.observe(host);
  fit(); draw();

  return {
    mark(i) { markIdx = i; placeMarker(); },
    highlight(range) { hlRange = range; draw(); },
    destroy() { ro.disconnect(); },
  };
}
