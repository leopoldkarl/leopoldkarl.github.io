"""Schwellenunabhaengige Kennzahlen auf 1-Hz-Reihen (reines Python).

Konventionen: eine Reihe ist eine Liste mit einem Wert je Sekunde
Bewegungszeit; ``None`` heisst "kein Messwert".
"""
from __future__ import annotations

import math

DURATIONS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420,
             600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400, 18000]


def _ffill(xs):
    out, last = [], None
    for x in xs:
        if x is not None:
            last = x
        out.append(last)
    first = next((x for x in out if x is not None), None)
    return [first if x is None else x for x in out] if first is not None else []


def mean_max(xs, durations=DURATIONS, skip_none=False):
    """Maximaler gleitender Mittelwert je Fensterlaenge (Sekunden)."""
    if skip_none:
        xs = _ffill(xs)
    else:
        xs = [0.0 if x is None else x for x in xs]
    n = len(xs)
    cs = [0.0]
    for x in xs:
        cs.append(cs[-1] + x)
    out = []
    for d in durations:
        if d > n:
            out.append(None)
            continue
        best = max(cs[i + d] - cs[i] for i in range(n - d + 1))
        out.append(best / d)
    return out


def normalized(xs, window=30):
    """(Mittel der 4. Potenz des gleitenden 30-s-Mittels)^(1/4).

    Fuer Leistung ist das Coggans Normalized Power; auf die
    steigungskorrigierte Geschwindigkeit angewandt dient es hier als NGP.
    """
    n = len(xs)
    if n == 0:
        return None
    if n < window:
        return sum(xs) / n
    s = sum(xs[:window])
    acc = (s / window) ** 4
    cnt = 1
    for i in range(window, n):
        s += xs[i] - xs[i - window]
        acc += (max(s, 0.0) / window) ** 4
        cnt += 1
    return (acc / cnt) ** 0.25


def histogram(xs, width):
    """Sekunden je Klasse [k*width, (k+1)*width). Rueckgabe [k0, c_k0, ...]."""
    counts = {}
    for x in xs:
        if x is None or x < 0:
            continue
        k = int(math.floor(x / width + 1e-9))
        counts[k] = counts.get(k, 0) + 1
    if not counts:
        return None
    lo, hi = min(counts), max(counts)
    return [lo] + [counts.get(k, 0) for k in range(lo, hi + 1)]


def best_efforts(dist, targets):
    """Kuerzeste Zeit (s, Bewegungszeit) fuer jede Zieldistanz (m)."""
    d = []
    m = None
    for x in dist:
        if x is not None:
            m = x if m is None else max(m, x)
        d.append(m)
    first = next((i for i, x in enumerate(d) if x is not None), None)
    if first is None:
        return {}
    d = d[first:]
    n = len(d)
    out = {}
    for L in targets:
        if d[-1] - d[0] < L:
            continue
        best = math.inf
        j = 0
        for i in range(n):
            if j < i:
                j = i
            while j < n and d[j] - d[i] < L:
                j += 1
            if j == n:
                break
            # lineare Interpolation innerhalb der letzten Sekunde
            prev = d[j - 1] - d[i] if j > i else 0.0
            step = d[j] - d[j - 1] if j > i else d[j] - d[i]
            frac = (L - prev) / step if step > 0 else 1.0
            t = (j - 1 - i) + frac if j > i else frac
            best = min(best, t)
        if best < math.inf:
            out[str(L)] = round(best, 1)
    return out


def decoupling(output, hr):
    """Pa:HR bzw. Pw:HR: relative Abnahme von Output/HF von der ersten zur
    zweiten Haelfte, in Prozent. Positiv = Drift."""
    pairs = [(o, h) for o, h in zip(output, hr) if h is not None and h > 0 and o is not None]
    if len(pairs) < 600:
        return None
    half = len(pairs) // 2

    def ef(ps):
        return (sum(p[0] for p in ps) / len(ps)) / (sum(p[1] for p in ps) / len(ps))
    e1, e2 = ef(pairs[:half]), ef(pairs[half:])
    if e1 <= 0:
        return None
    return (e1 - e2) / e1 * 100


def minetti_cost(i):
    """Energiekosten des Laufens (J/kg/m) als Funktion der Steigung i
    (Minetti et al., J Appl Physiol 93 (2002)); gueltig fuer |i| <= 0.45."""
    i = max(-0.45, min(0.45, i))
    return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6


def grades(dist, alt, half_window=10):
    n = len(dist)
    out = [0.0] * n
    if alt is None:
        return out
    a = _ffill(alt)
    d = _ffill(dist)
    if not a or not d:
        return out
    for k in range(n):
        lo, hi = max(0, k - half_window), min(n - 1, k + half_window)
        dd = d[hi] - d[lo]
        if dd > 10:
            out[k] = max(-0.45, min(0.45, (a[hi] - a[lo]) / dd))
    return out


def grade_adjusted_speed(v, dist, alt):
    g = grades(dist, alt)
    c0 = minetti_cost(0.0)
    return [None if x is None else x * minetti_cost(gi) / c0 for x, gi in zip(v, g)]


def splits(dist, hr, alt, gap, length):
    """Abschnitte gleicher Distanz auf der Bewegungszeit-Achse."""
    d = _ffill(dist)
    if not d:
        return []
    out = []
    start_i = 0
    start_d = d[0]
    target = start_d + length

    def seg(i0, i1, dist_m):
        hrs = [x for x in hr[i0:i1] if x is not None]
        gp = [x for x in (gap[i0:i1] if gap else []) if x is not None]
        up = down = 0.0
        if alt:
            ref = None
            for x in alt[i0:i1 + 1]:
                if x is None:
                    continue
                if ref is None:
                    ref = x
                elif x - ref >= 2:        # 2-m-Hysterese gegen Rauschen
                    up += x - ref
                    ref = x
                elif ref - x >= 2:
                    down += ref - x
                    ref = x
        return {
            "dist": round(dist_m, 1),
            "dur": i1 - i0,
            "hr": round(sum(hrs) / len(hrs)) if hrs else None,
            "up": round(up), "down": round(down),
            "gap": round(sum(gp) / len(gp), 3) if gp else None,
        }
    for i in range(1, len(d)):
        while d[i] >= target:
            out.append(seg(start_i, i, length))
            start_i = i
            target += length
    rest = d[-1] - (target - length)
    if rest > length * 0.05 and len(d) - 1 > start_i:
        out.append(seg(start_i, len(d) - 1, rest))
    return out
