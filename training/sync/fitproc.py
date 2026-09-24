"""FIT-Dateien -> aufbereitete Aktivitaeten.

Ausgabe je Session (Mehrsport-Dateien liefern mehrere) ein Paar
(summary, detail). Beide enthalten ausschliesslich Groessen, die NICHT von
Schwellenwerten (FTP, LTHR, Schwellenpace, CSS) abhaengen; alles
Schwellenabhaengige (TSS, IF, Zonen) rechnet der Browser. Dadurch muss bei
einer neuen FTP nichts neu erzeugt oder neu verschluesselt werden.

Zeitachsen
----------
* "elapsed": Sekunden seit Start, mit Pausen (fuer die Anzeige).
* "moving":  1-Hz-Raster ueber alle Sekunden, in denen Records vorliegen,
  Pausen herausgeschnitten (Luecken > GAP_S). Grundlage fuer Mean-Max,
  NP, NGP, Bestzeiten, Histogramme.
"""
from __future__ import annotations

import datetime as _dt
import math
from typing import Any

from garmin_fit_sdk import Decoder, Stream

from metrics import (
    DURATIONS, best_efforts, decoupling, histogram, mean_max, normalized,
    grade_adjusted_speed, splits,
)

PROCESSOR_VERSION = 3
FIT_EPOCH = 631065600          # 1989-12-31T00:00:00Z in Unix-Sekunden
GAP_S = 12                     # groessere Luecken gelten als Pause
SEMI = 180.0 / 2 ** 31         # Semicircles -> Grad
MAX_DISPLAY_POINTS = 4000

RUN_DISTANCES = [400, 1000, 1609, 3000, 5000, 10000, 15000, 21097, 30000, 42195]
RIDE_DISTANCES = [5000, 10000, 20000, 40000, 50000, 100000, 160934]
SWIM_DISTANCES = [100, 200, 400, 800, 1000, 1500, 1900, 3800]


class NotAnActivity(Exception):
    pass


# --------------------------------------------------------------------------
# Kategorien
# --------------------------------------------------------------------------

def category(sport: str | None, sub: str | None) -> str:
    sport = (sport or "").lower()
    sub = (sub or "").lower()
    if sport == "running":
        return "run"
    if sport in ("cycling", "e_biking"):
        return "ride"
    if sport == "swimming":
        return "swim"
    if sub in ("strength_training", "cardio_training", "hiit"):
        return "strength"
    if sport == "training" and sub in ("", "generic", "all"):
        return "strength"
    return "other"


# --------------------------------------------------------------------------
# Hilfen
# --------------------------------------------------------------------------

def _epoch(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, _dt.datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=_dt.timezone.utc)
        return v.timestamp()
    if isinstance(v, (int, float)):
        return float(v) + FIT_EPOCH
    return None


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, (str, bytes)):
        return None
    if isinstance(v, (list, tuple)):
        v = v[0] if v else None
        if v is None:
            return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pick(d: dict, *names: str) -> float | None:
    for n in names:
        v = _num(d.get(n))
        if v is not None:
            return v
    return None


def _haversine(lat1, lon1, lat2, lon2) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _r(v, nd=1):
    return None if v is None else round(v, nd)


def _i(v):
    return None if v is None else int(round(v))


# --------------------------------------------------------------------------
# Einlesen
# --------------------------------------------------------------------------

def decode(data: bytes) -> dict:
    stream = Stream.from_byte_array(bytearray(data))
    dec = Decoder(stream)
    if not dec.is_fit():
        raise NotAnActivity("keine FIT-Datei")
    msgs, errors = dec.read(enable_crc_check=False)
    if errors and not msgs.get("record_mesgs") and not msgs.get("session_mesgs"):
        raise NotAnActivity(f"FIT nicht lesbar: {errors[0]}")
    fid = (msgs.get("file_id_mesgs") or [{}])[0]
    if fid.get("type") not in ("activity", None):
        raise NotAnActivity(f"Dateityp {fid.get('type')}")
    if not msgs.get("session_mesgs") and not msgs.get("record_mesgs"):
        raise NotAnActivity("keine Session")
    return msgs


def _records(msgs) -> list[dict]:
    out = []
    for r in msgs.get("record_mesgs", []):
        ts = _epoch(r.get("timestamp"))
        if ts is None:
            continue
        lat, lon = _num(r.get("position_lat")), _num(r.get("position_long"))
        if lat is not None and lon is not None and (abs(lat) < 2 ** 31 - 1) and not (lat == 0 and lon == 0):
            lat, lon = lat * SEMI, lon * SEMI
        else:
            lat = lon = None
        cad = _num(r.get("cadence"))
        frac = _num(r.get("fractional_cadence"))
        if cad is not None and frac is not None:
            cad += frac
        out.append({
            "ts": ts,
            "lat": lat, "lon": lon,
            "dist": _pick(r, "distance"),
            "v": _pick(r, "speed", "enhanced_speed"),
            "alt": _pick(r, "altitude", "enhanced_altitude"),
            "hr": _pick(r, "heart_rate"),
            "pw": _pick(r, "power"),
            "cad": cad,
            "temp": _pick(r, "temperature"),
        })
    out.sort(key=lambda x: x["ts"])
    # doppelte Zeitstempel zusammenfassen (letzter gewinnt, Felder ergaenzen)
    dedup: list[dict] = []
    for rec in out:
        if dedup and int(dedup[-1]["ts"]) == int(rec["ts"]):
            for k, v in rec.items():
                if v is not None:
                    dedup[-1][k] = v
        else:
            dedup.append(dict(rec))
    return dedup


def _tz_offset_min(msgs) -> int:
    for a in msgs.get("activity_mesgs", []):
        ts = _epoch(a.get("timestamp"))
        lt = a.get("local_timestamp")
        if ts is not None and isinstance(lt, (int, float)):
            off = (lt + FIT_EPOCH) - ts
            q = int(round(off / 900.0)) * 15          # auf Viertelstunden
            if -14 * 60 <= q <= 14 * 60:
                return q
    return 0


# --------------------------------------------------------------------------
# Privatzonen
# --------------------------------------------------------------------------

def apply_privacy(recs: list[dict], zones: list[dict]) -> int:
    if not zones:
        return 0
    n = 0
    for r in recs:
        if r["lat"] is None:
            continue
        for z in zones:
            if _haversine(r["lat"], r["lon"], z["lat"], z["lon"]) <= z.get("radius_m", 400):
                r["lat"] = r["lon"] = None
                n += 1
                break
    return n


# --------------------------------------------------------------------------
# 1-Hz-Raster
# --------------------------------------------------------------------------

def _moving_grid(recs: list[dict]):
    """Liefert eine Liste von Segmenten; jedes Segment ist ein dict von
    1-Hz-Listen. Luecken <= GAP_S werden linear interpoliert (Leistung:
    gehalten), groessere beenden das Segment (Pause)."""
    keys = ("hr", "v", "dist", "alt", "cad")
    segs = []
    cur = None
    prev = None
    last = None
    for r in recs:
        t = int(round(r["ts"]))
        if prev is not None and t <= prev:
            continue
        if prev is None or t - prev > GAP_S:
            cur = {k: [] for k in ("ts", "pw") + keys}
            segs.append(cur)
            steps = 1
            prev = t - 1
            last = {k: None for k in ("pw",) + keys}
        else:
            steps = t - prev
        for s in range(1, steps + 1):
            end = s == steps
            f = s / steps
            cur["ts"].append(prev + s)
            for k in keys:
                a, b = last[k], r[k]
                if end:
                    cur[k].append(b)
                elif a is None or b is None:
                    cur[k].append(a)
                else:
                    cur[k].append(a + (b - a) * f)
            cur["pw"].append(r["pw"] if end else last["pw"])
        prev = t
        last = {k: r[k] for k in ("pw",) + keys}
    return [s for s in segs if s["ts"]]


def _concat(segs, key):
    out = []
    for s in segs:
        out.extend(s[key])
    return out


def _fill_distance(recs):
    """Distanz aus GPS rekonstruieren, falls die Uhr keine liefert."""
    if any(r["dist"] is not None for r in recs):
        # Vorwaerts auffuellen, damit Luecken nicht als 0 zaehlen
        last = None
        for r in recs:
            if r["dist"] is None:
                r["dist"] = last
            else:
                last = r["dist"]
        return
    d = 0.0
    pl = None
    for r in recs:
        if r["lat"] is not None:
            if pl is not None:
                d += _haversine(pl[0], pl[1], r["lat"], r["lon"])
            pl = (r["lat"], r["lon"])
        r["dist"] = d if pl is not None else None


# --------------------------------------------------------------------------
# Anzeige-Streams
# --------------------------------------------------------------------------

def _display_streams(recs: list[dict], t0: float, has: dict) -> dict:
    n = len(recs)
    step = max(1, math.ceil(n / MAX_DISPLAY_POINTS))
    cols = {k: [] for k in ("t", "d", "hr", "pw", "v", "alt", "cad", "temp", "lat", "lon")}
    for i in range(0, n, step):
        chunk = recs[i:i + step]

        def avg(key):
            vals = [c[key] for c in chunk if c[key] is not None]
            return sum(vals) / len(vals) if vals else None
        mid = chunk[len(chunk) // 2]
        cols["t"].append(int(round(mid["ts"] - t0)))
        cols["d"].append(_r(mid["dist"], 1))
        cols["hr"].append(_i(avg("hr")))
        cols["pw"].append(_i(avg("pw")))
        v = avg("v")
        cols["v"].append(_i(v * 100) if v is not None else None)        # cm/s
        a = avg("alt")
        cols["alt"].append(_i(a * 10) if a is not None else None)       # dm
        cols["cad"].append(_i(avg("cad")))
        cols["temp"].append(_i(avg("temp")))
        cols["lat"].append(_i(mid["lat"] * 1e5) if mid["lat"] is not None else None)
        cols["lon"].append(_i(mid["lon"] * 1e5) if mid["lon"] is not None else None)
    # leere Kanaele weglassen
    return {k: v for k, v in cols.items() if k in ("t",) or any(x is not None for x in v)}


# --------------------------------------------------------------------------
# Hauptfunktion
# --------------------------------------------------------------------------

def process(data: bytes, privacy_zones: list[dict] | None = None) -> list[tuple[dict, dict]]:
    msgs = decode(data)
    tz = _tz_offset_min(msgs)
    all_recs = _records(msgs)
    fid = (msgs.get("file_id_mesgs") or [{}])[0]
    device = fid.get("garmin_product") or fid.get("product_name")
    if isinstance(device, int):
        device = None

    sessions = msgs.get("session_mesgs") or []
    if not sessions:
        # Fallback: eine Session aus den Records
        if not all_recs:
            raise NotAnActivity("leer")
        sport = (msgs.get("sport_mesgs") or [{}])[0]
        sessions = [{
            "start_time": all_recs[0]["ts"] - FIT_EPOCH,
            "timestamp": all_recs[-1]["ts"] - FIT_EPOCH,
            "sport": sport.get("sport", "generic"),
            "sub_sport": sport.get("sub_sport"),
        }]

    results = []
    sessions = sorted(sessions, key=lambda s: _epoch(s.get("start_time")) or 0)
    for si, s in enumerate(sessions):
        start = _epoch(s.get("start_time"))
        if start is None:
            continue
        elapsed = _num(s.get("total_elapsed_time"))
        end = start + elapsed if elapsed else (_epoch(s.get("timestamp")) or start)
        nxt = _epoch(sessions[si + 1].get("start_time")) if si + 1 < len(sessions) else None
        recs = [dict(r) for r in all_recs if start - 1 <= r["ts"] <= end + 1 and (nxt is None or r["ts"] < nxt)]
        laps = [l for l in msgs.get("lap_mesgs", []) if start - 1 <= (_epoch(l.get("start_time")) or -1) <= end + 1]
        lengths = [l for l in msgs.get("length_mesgs", []) if start - 1 <= (_epoch(l.get("start_time")) or -1) <= end + 1]
        sets = [x for x in msgs.get("set_mesgs", []) if start - 1 <= (_epoch(x.get("start_time") or x.get("timestamp")) or -1) <= end + 1]
        results.append(_session(s, recs, laps, lengths, sets, tz, device, privacy_zones or [], len(sessions) > 1))
    if not results:
        raise NotAnActivity("keine verwertbare Session")
    return results


def _session(s, recs, laps, lengths, sets, tz, device, zones, multisport):
    start = _epoch(s["start_time"])
    sport = s.get("sport") if isinstance(s.get("sport"), str) else "generic"
    sub = s.get("sub_sport") if isinstance(s.get("sub_sport"), str) else None
    cat = category(sport, sub)

    _fill_distance(recs)
    hidden = apply_privacy(recs, zones)

    has = {k: any(r[k] is not None for r in recs) for k in ("hr", "pw", "v", "alt", "cad", "lat", "dist", "temp")}
    segs = _moving_grid(recs) if recs else []
    hr1 = _concat(segs, "hr")
    pw1 = _concat(segs, "pw")
    v1 = _concat(segs, "v")
    d1 = _concat(segs, "dist")
    alt1 = _concat(segs, "alt")
    moving_s = len(hr1)

    # Geschwindigkeit aus Distanz, falls kein Speed-Kanal
    if not has["v"] and has["dist"]:
        v1 = [None] + [
            (d1[i] - d1[i - 1]) if d1[i] is not None and d1[i - 1] is not None else None
            for i in range(1, len(d1))
        ]

    elapsed = _num(s.get("total_elapsed_time")) or (recs[-1]["ts"] - start if recs else 0)
    timer = _num(s.get("total_timer_time")) or moving_s or elapsed
    dist = _num(s.get("total_distance"))
    if dist is None and d1:
        dist = max((x for x in d1 if x is not None), default=None)

    local = _dt.datetime.fromtimestamp(start, _dt.timezone.utc) + _dt.timedelta(minutes=tz)
    aid = local.strftime("%Y%m%dT%H%M%S")

    # --- Aufstieg aus Records, falls Session es nicht liefert
    ascent = _num(s.get("total_ascent"))
    descent = _num(s.get("total_descent"))
    if ascent is None and has["alt"]:
        ascent, descent = _ascent([r["alt"] for r in recs])

    summ: dict[str, Any] = {
        "id": aid,
        "ts": int(start),
        "start": local.strftime("%Y-%m-%dT%H:%M:%S"),
        "tz": tz,
        "cat": cat,
        "sport": sport,
        "sub": sub,
        "device": device,
        "elapsed": _i(elapsed),
        "moving": _i(timer),
        "dist": _r(dist, 1),
        "ascent": _i(ascent),
        "descent": _i(descent),
        "hr_avg": _i(_pick(s, "avg_heart_rate")) or _i(_mean(hr1)),
        "hr_max": _i(_pick(s, "max_heart_rate")) or _i(_max(hr1)),
        "pw_avg": _i(_pick(s, "avg_power")) or _i(_mean(pw1)),
        "pw_max": _i(_pick(s, "max_power")) or _i(_max(pw1)),
        "v_avg": _r(_pick(s, "enhanced_avg_speed", "avg_speed") or ((dist / timer) if dist and timer else None), 3),
        "v_max": _r(_pick(s, "enhanced_max_speed", "max_speed") or _max(v1), 3),
        "cad_avg": _i(_pick(s, "avg_cadence")),
        "kcal": _i(_pick(s, "total_calories")),
        "te_aer": _r(_pick(s, "total_training_effect"), 1),
        "te_ana": _r(_pick(s, "total_anaerobic_training_effect"), 1),
        "gps": has["lat"],
        "multisport": multisport,
    }
    if cat == "run" and summ["cad_avg"] is not None:
        frac = _num(s.get("avg_fractional_cadence")) or 0
        summ["cad_avg"] = int(round((summ["cad_avg"] + frac) * 2))   # Schritte/min

    # --- schwellenunabhaengige Kennzahlen
    if has["pw"] and pw1:
        pw0 = [p if p is not None else 0.0 for p in pw1]
        summ["np"] = _i(normalized(pw0, 30))
        summ["mm_pw"] = [_i(x) for x in mean_max(pw0, DURATIONS)]
        summ["h_pw"] = histogram(pw1, 10)
        if cat in ("ride", "run"):
            summ["work_kj"] = _i(sum(pw0) / 1000)
    if has["hr"] and hr1:
        summ["mm_hr"] = [_i(x) for x in mean_max(hr1, DURATIONS, skip_none=True)]
        summ["h_hr"] = histogram(hr1, 1)
    if v1 and any(x is not None for x in v1) and cat in ("run", "ride", "swim", "other"):
        v0 = [x if x is not None else 0.0 for x in v1]
        summ["mm_v"] = [_r(x, 3) for x in mean_max(v0, DURATIONS)]
        summ["h_v"] = histogram(v1, 0.1)
    gap1 = None
    if cat == "run" and d1 and has["dist"]:
        gap1 = grade_adjusted_speed(v1, d1, alt1 if has["alt"] else None)
        gap0 = [x if x is not None else 0.0 for x in gap1]
        vals = [x for x in gap1 if x is not None and x > 0.5]
        summ["gap"] = _r(sum(vals) / len(vals), 3) if vals else None
        summ["ngp"] = _r(normalized(gap0, 30), 3)
        summ["h_gap"] = histogram(gap1, 0.1)
    dists = {"run": RUN_DISTANCES, "ride": RIDE_DISTANCES, "swim": SWIM_DISTANCES}.get(cat)
    if dists and d1 and has["dist"]:
        summ["best"] = best_efforts(d1, dists)
    if has["hr"] and moving_s >= 1200:
        if cat == "ride" and has["pw"]:
            summ["decoupling"] = _r(decoupling([p or 0 for p in pw1], hr1), 1)
        elif cat == "run" and v1:
            summ["decoupling"] = _r(decoupling([x or 0 for x in v1], hr1), 1)

    # --- Schwimmen
    detail_extra = {}
    if cat == "swim":
        summ["pool"] = _r(_num(s.get("pool_length")), 1)
        summ["strokes"] = _i(_num(s.get("total_strokes")))
        L = []
        for l in lengths:
            L.append({
                "t": _i(_epoch(l.get("start_time")) - start),
                "dur": _r(_num(l.get("total_timer_time")) or _num(l.get("total_elapsed_time")), 1),
                "active": l.get("length_type") != "idle",
                "stroke": l.get("swim_stroke") if isinstance(l.get("swim_stroke"), str) else None,
                "strokes": _i(_num(l.get("total_strokes"))),
            })
        if L:
            detail_extra["lengths"] = L
            act = [x for x in L if x["active"] and x["dur"]]
            if summ["pool"] and act:
                # Bestzeiten aus Bahnen (kein Distanzkanal im Becken)
                summ["best"] = _pool_best(act, summ["pool"], SWIM_DISTANCES)
                summ["mm_v"] = None

    # --- Kraft
    if sets:
        S = []
        for x in sets:
            if x.get("set_type") == "rest":
                continue
            cat_name = x.get("category")
            if isinstance(cat_name, (list, tuple)):
                cat_name = cat_name[0] if cat_name else None
            S.append({
                "t": _i((_epoch(x.get("start_time") or x.get("timestamp")) or start) - start),
                "dur": _r(_num(x.get("duration")), 1),
                "reps": _i(_num(x.get("repetitions"))),
                "kg": _r(_num(x.get("weight")), 1),
                "ex": cat_name if isinstance(cat_name, str) else None,
            })
        if S:
            detail_extra["sets"] = S
            summ["sets"] = len(S)
            summ["reps"] = sum(x["reps"] or 0 for x in S)
            summ["volume_kg"] = _i(sum((x["reps"] or 0) * (x["kg"] or 0) for x in S))

    # --- Runden
    L = []
    for l in laps:
        ls = _epoch(l.get("start_time"))
        L.append({
            "t": _i(ls - start) if ls else None,
            "dur": _r(_num(l.get("total_timer_time")), 1),
            "dist": _r(_num(l.get("total_distance")), 1),
            "hr": _i(_num(l.get("avg_heart_rate"))),
            "hr_max": _i(_num(l.get("max_heart_rate"))),
            "pw": _i(_num(l.get("avg_power"))),
            "np": _i(_num(l.get("normalized_power"))),
            "v": _r(_pick(l, "enhanced_avg_speed", "avg_speed"), 3),
            "asc": _i(_num(l.get("total_ascent"))),
            "cad": _i(_num(l.get("avg_cadence"))),
        })

    detail: dict[str, Any] = {
        "id": aid,
        "streams": _display_streams(recs, start, has) if recs else {"t": []},
        "laps": L,
        "privacy_hidden": hidden,
        **detail_extra,
    }
    if cat in ("run", "other", "ride") and has["dist"] and segs:
        detail["splits"] = splits(d1, hr1, alt1 if has["alt"] else None, gap1,
                                  5000 if cat == "ride" else 1000)
    return summ, detail


def _pool_best(active, pool, targets):
    """Schnellste zusammenhaengende Bahnfolge mit Distanz >= Ziel."""
    out = {}
    durs = [x["dur"] for x in active]
    for target in targets:
        n = math.ceil(target / pool - 1e-9)
        if n > len(durs) or n <= 0:
            continue
        acc = sum(durs[:n])
        best = acc
        for i in range(n, len(durs)):
            acc += durs[i] - durs[i - n]
            best = min(best, acc)
        out[str(target)] = round(best, 1)
    return out


def _ascent(alts):
    up = down = 0.0
    ref = None
    for a in alts:
        if a is None:
            continue
        if ref is None:
            ref = a
            continue
        d = a - ref
        if d >= 2:         # 2-m-Hysterese gegen Rauschen
            up += d
            ref = a
        elif d <= -2:
            down -= d
            ref = a
    return up, down


def _mean(xs):
    v = [x for x in xs if x is not None]
    return sum(v) / len(v) if v else None


def _max(xs):
    v = [x for x in xs if x is not None]
    return max(v) if v else None
