// dragscroll.js — automatisches Scrollen am Rand, waehrend etwas gezogen wird.
//
// Ohne das endet eine Ziehbewegung am unteren Rand der sichtbaren Liste: wer
// einen Block weiter unten ablegen will, als die Spalte reicht, muesste erst
// loslassen, scrollen und neu ansetzen.
//
// Die Geschwindigkeit waechst linear, je tiefer der Zeiger in die Randzone
// ragt — am aeussersten Rand volle Fahrt, knapp innerhalb kaum merklich.
// Ein fester Wert fuehlt sich entweder traege oder unkontrollierbar an.

const EDGE = 56;        // Breite der Randzone in px
const MAX_SPEED = 18;   // px je Bild, also rund 1000 px/s bei 60 Hz

/**
 * @param {{edge?: number, maxSpeed?: number, onScroll?: (x: number, y: number) => void}} opt
 *   `onScroll` wird nach jedem wirksamen Scrollschritt mit der zuletzt
 *   bekannten Zeigerposition aufgerufen — der Aufrufer kann damit seinen
 *   Platzhalter neu einsortieren, obwohl sich der Zeiger nicht bewegt.
 */
export function createEdgeScroller({ edge = EDGE, maxSpeed = MAX_SPEED, onScroll } = {}) {
  let raf = null;
  let state = null;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    state = null;
  }

  function tick() {
    raf = null;
    if (!state) return;
    const { list, speed, x, y } = state;
    const vorher = list.scrollTop;
    list.scrollTop = vorher + speed;
    // Am Ende der Liste angekommen: nichts bewegt sich mehr, also aufhoeren
    // zu rechnen, statt sechzigmal je Sekunde dasselbe zu tun.
    if (list.scrollTop === vorher) { stop(); return; }
    if (onScroll) onScroll(x, y);
    raf = requestAnimationFrame(tick);
  }

  /**
   * Zeigerposition melden. `list` ist der Scrollbereich darunter oder null;
   * liegt der Zeiger ausserhalb jeder Liste, haelt das Scrollen an.
   */
  function update(list, x, y) {
    if (!list) { stop(); return; }
    const r = list.getBoundingClientRect();
    const obenRein = y - r.top;
    const untenRein = r.bottom - y;
    let speed = 0;
    if (untenRein < edge) {
      speed = Math.ceil(maxSpeed * (1 - Math.max(untenRein, 0) / edge));
    } else if (obenRein < edge) {
      speed = -Math.ceil(maxSpeed * (1 - Math.max(obenRein, 0) / edge));
    }
    if (!speed) { stop(); return; }
    state = { list, speed, x, y };
    if (!raf) raf = requestAnimationFrame(tick);
  }

  return { update, stop };
}
