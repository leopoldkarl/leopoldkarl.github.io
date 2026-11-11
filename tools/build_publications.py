#!/usr/bin/env python3
"""Schreibt die Publikationsliste aus data/publications.json in die Seiten.

    python tools/build_publications.py           # Seiten neu schreiben
    python tools/build_publications.py --check   # nur pruefen, nichts aendern

Ersetzt in jeder Zielseite den Bereich zwischen
    <!-- publications:start -->  und  <!-- publications:end -->
Alles ausserhalb der Marken bleibt unberuehrt. Die Liste steht danach als
statisches HTML in beiden Seiten - kein JavaScript noetig, Suchmaschinen und
Leser ohne JS sehen sie ebenso.
"""
import argparse, html, json, sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
QUELLE = WURZEL / "data" / "publications.json"
ZIELE = [WURZEL / "index.html", WURZEL / "research" / "index.html"]
START, ENDE = "<!-- publications:start -->", "<!-- publications:end -->"
E = 6 * " "   # Grundeinzug der Karten


def esc(t):
    return html.escape(t, quote=False)


def link(text, url, gc=None):
    if not url:
        return esc(text)
    attr = f' data-goatcounter-click="{html.escape(gc)}"' if gc else ""
    return f'<a href="{html.escape(url)}"{attr} target="_blank" rel="noopener">{esc(text)}</a>'


def preprint(p):
    mit = ""
    if p.get("koautoren"):
        namen = ", ".join(link(k["name"], k.get("url"), k.get("gc")) for k in p["koautoren"])
        mit = f" (with {namen})"
    arxiv = link("arXiv", f"https://arxiv.org/abs/{p['arxiv']}", p.get("gc"))
    return (f'{E}        <li><strong>{esc(p["titel"])}</strong>{mit}, \n'
            f'{E}          [{arxiv}], preprint ({p["jahr"]})</li>')


def arbeit(a):
    titel = link(a["titel"], a.get("url"), a.get("gc"))
    b = a.get("betreuung") or {}
    betreut = f' Supervised by {link(b["name"], b.get("url"), b.get("gc"))}.' if b.get("name") else ""
    return (f'{E}      <li><strong>{esc(a["art"])}</strong> ({esc(a["datum"])}): \n'
            f'{E}        {titel}, {esc(a["institution"])}.{betreut}</li>')


def block(d):
    zeilen = [
        f'{E}<div style="margin-top:0.75rem">',
        f'{E}  <div>',
        f'{E}    <div class="card">',
        f'{E}      <h3>Preprints</h3>',
        f'{E}      <p style="margin-top:0.25rem; margin-bottom:0.25rem">Most of my publications are available as preprints on ',
        f'{E}        {link("arXiv", d["arxiv_suche"], "arxiv-search")}.</p>',
        f'{E}      <ol>',
        *[preprint(p) for p in d["preprints"]],
        f'{E}      </ol>',
        f'{E}      <p style="margin-top:0.25rem; margin-bottom:0.25rem">Here you find my (inactive) ',
        f'{E}        {link("ORCID", d["orcid"], "orcid")} profile.</p>',
        f'{E}    </div>',
        f'{E}  </div>',
        '',
        f'{E}  <div class="card" style="margin-top:0.75rem">',
        f'{E}    <h3>Thesis</h3>',
        f'{E}    <ul>',
        *[arbeit(a) for a in d["abschlussarbeiten"]],
        f'{E}    </ul>',
        f'{E}  </div>',
        f'{E}</div>',
    ]
    return "\n".join(zeilen)


def main(pruefen: bool) -> int:
    d = json.loads(QUELLE.read_text(encoding="utf-8"))
    neu = block(d)
    abweichung = 0
    for ziel in ZIELE:
        s = ziel.read_text(encoding="utf-8")
        i, j = s.find(START), s.find(ENDE)
        if i < 0 or j < 0:
            sys.exit(f"Marken fehlen in {ziel.relative_to(WURZEL)}")
        alt = s[i + len(START):j]
        rest = s[j + len(ENDE):]
        if not rest.startswith("\n"):
            rest = "\n    " + rest.lstrip(" ")
        ersetzt = s[:i + len(START)] + "\n" + neu + "\n" + E + ENDE + rest
        if ersetzt == s:
            print(f"unveraendert: {ziel.relative_to(WURZEL)}")
            continue
        abweichung += 1
        if pruefen:
            print(f"wuerde sich aendern: {ziel.relative_to(WURZEL)}")
        else:
            ziel.write_text(ersetzt, encoding="utf-8", newline="")
            print(f"geschrieben: {ziel.relative_to(WURZEL)}")
    return 1 if (pruefen and abweichung) else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="nur melden, ob die Seiten aktuell sind")
    sys.exit(main(ap.parse_args().check))
