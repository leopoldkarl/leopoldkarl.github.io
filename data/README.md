# data/publications.json

Einzige Quelle der Publikationsliste. Sie erscheint auf zwei Seiten:
`/` (Abschnitt „List of Publications") und `/research/`.

Neue Arbeit eintragen: `data/publications.json` ergänzen, dann

    python tools/build_publications.py

Das Skript schreibt den Block zwischen den Marken

    <!-- publications:start -->   …   <!-- publications:end -->

in beiden Seiten neu; alles außerhalb bleibt unberührt. `--check` meldet
nur, ob die Seiten zur JSON-Datei passen (Rückgabewert 1, wenn nicht) —
nützlich, bevor du committest.

Die Liste steht danach als statisches HTML in den Seiten. Kein JavaScript
nötig: Suchmaschinen, Scholar-Crawler und Leser ohne JS sehen sie ebenso.
