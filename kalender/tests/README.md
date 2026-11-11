# Prüfungen

Liegen bewusst **im Repo**: eine frühere Fassung lag nur im Arbeitsbereich
einer Sitzung und ging mit diesem verloren.

    node tests/run.mjs            # alles
    node tests/run.mjs unit       # nur Einheitentests (ohne Browser)

`run.mjs` startet selbst einen statischen Server auf 127.0.0.1:8765 mit dem
**Repo-Wurzelverzeichnis** als Wurzel — die Kalenderseite liegt also unter
`/kalender/index.html`. Das ist nötig, weil der Trainingsplan ein Modul aus
`/training/js/` lädt.

Die Browsertests brauchen Playwright mit Chromium
(`npm i -g playwright && npx playwright install chromium`).

Echte Trainingsdaten werden nie gebraucht: die Prüfungen tauschen den Lader
in `js/trainingquelle.js` über `setImporter` gegen eine Attrappe.
