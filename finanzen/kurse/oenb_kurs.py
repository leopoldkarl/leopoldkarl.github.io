#!/usr/bin/env python3
"""Wöchentlicher EUR-CHF-Kurs für /finanzen aus dem Webservice der OeNB.

    python finanzen/kurse/oenb_kurs.py            # kurse.json ergänzen
    python finanzen/kurse/oenb_kurs.py --dry-run  # nur anzeigen

Quelle: OeNB-Webservice, Reihe VDBKUREFEURCHF („Referenzkurse der EZB EUR-CHF“,
Hierarchie 2503, täglich). Seit 1999 hat die OeNB keinen eigenen Mittelkurs
mehr; sie veröffentlicht den Referenzkurs der EZB (Fixing ca. 16:00 MEZ).
Einheit: CHF je 1 EUR — dieselbe Notierung wie `chfPerEur` in der Seite.

Je Kalenderwoche (ISO) wird genau ein Kurs übernommen: der letzte
veröffentlichte der Woche (normalerweise Freitag). Beim ersten Lauf werden die
Wochen ab START nachgetragen. Läuft als GitHub-Action
(.github/workflows/wechselkurs.yml); nur Standardbibliothek.

Die Datei ist öffentlich und enthält nur öffentliche Kurse, keine Finanzdaten.
"""
import argparse, datetime as dt, json, sys, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "kurse.json"
START = "2026-04-01"
URL = ("https://www.oenb.at/isadataservice/data?lang=DE&hierid=2503"
       "&pos=VDBKUREFEURCHF&freq=D&starttime={start}")


def fetch(start: str) -> list[tuple[str, float]]:
    req = urllib.request.Request(URL.format(start=start), headers={"User-Agent": "leopoldkarl.com-finanzen/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        root = ET.fromstring(r.read())
    out = []
    for obs in root.iter("obs"):
        d, v = obs.get("periode"), obs.get("value")
        try:
            dt.date.fromisoformat(d)
            x = float(v)
        except (TypeError, ValueError):
            continue
        if 0.3 < x < 3:          # Plausibilität: EUR-CHF lag seit 1999 zwischen ~0,9 und ~1,7
            out.append((d, x))
    if not out:
        sys.exit("OeNB lieferte keine Beobachtungen — Format geändert oder Dienst gestört.")
    return sorted(out)


def weekly(obs: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Letzter Kurs je ISO-Woche."""
    last = {}
    for d, x in obs:
        y, w, _ = dt.date.fromisoformat(d).isocalendar()
        last[(y, w)] = (d, x)
    return [last[k] for k in sorted(last)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    rates = data.get("rates", [])
    have = {r["date"] for r in rates}
    last = max(have) if have else None
    # Eine Woche Überlappung, damit eine Woche, deren Freitag beim letzten Lauf
    # noch fehlte (Feiertag, verspätetes Fixing), sauber nachgezogen wird.
    start = (dt.date.fromisoformat(last) - dt.timedelta(days=7)).isoformat() if last else START
    weeks = weekly(fetch(start))

    known_weeks = {dt.date.fromisoformat(d).isocalendar()[:2] for d in have}
    new = []
    for d, x in weeks:
        wk = dt.date.fromisoformat(d).isocalendar()[:2]
        if wk in known_weeks:
            # Woche schon da, aber mit früherem Tag? Dann durch den späteren ersetzen.
            old = next(r for r in rates if dt.date.fromisoformat(r["date"]).isocalendar()[:2] == wk)
            if old["date"] < d:
                old.update(date=d, chfPerEur=x)
                new.append((d, x, "ersetzt"))
            continue
        rates.append({"date": d, "chfPerEur": x})
        new.append((d, x, "neu"))
    for d, x, how in new:
        print(f"{how}: {d}  1 EUR = {x} CHF")
    if not new:
        print("nichts Neues")
        return
    if a.dry_run:
        return
    rates.sort(key=lambda r: r["date"])
    out = {
        "source": "OeNB-Webservice, Referenzkurse der EZB EUR-CHF (VDBKUREFEURCHF), letzter Kurs je Woche",
        "unit": "CHF je 1 EUR",
        "updated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "rates": rates,
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
