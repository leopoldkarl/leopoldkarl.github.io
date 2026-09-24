# Training unter leopoldkarl.com/training

Analyse-Seite für die Aktivitäten der Garmin-Uhr, angelehnt an Strava und
TrainingPeaks. Zwei Teile:

    training/
      index.html, training.css, js/    die Seite (ES-Module, keine Abhängigkeiten, kein Build)
      sync/                            Python-Skript: Garmin → aufbereitete, verschlüsselte Daten
      data/                            Ausgabe des Skripts (wird committet, nur Chiffrat)

Wie `/kalender`: nicht von der Hauptseite verlinkt, `noindex`, kein GoatCounter.

## Funktionsumfang

**Übersicht** — Woche / 4 Wochen / Jahr, aktuelle Form (CTL/ATL/TSB),
Wochenvolumen nach Sportart (Zeit, Distanz, TSS), Aktivitätskalender der
letzten 12 Monate, kumulierter Jahresvergleich, letzte Aktivitäten.
**Aktivitäten** — Tabelle mit Suche, Jahr, Sortierung.
**Fitness** — Performance Management Chart (CTL, ATL, TSB, Tages-TSS),
TSS pro Woche, Zeit in HF-Zonen pro Woche, gültige Schwellenwerte.
**Bestleistungen** — Leistungskurve (Mean-Max) mit Gesamt / Jahr / 90 Tage,
Bestzeiten Laufen, Rad und Schwimmen, Pace-Kurve.
**Einzelaktivität** — Kennzahlen (NP, IF, TSS, VI, EF, Pa:HR, GAP/NGP, …),
Karte (OpenStreetMap), Verlauf von Pace/Geschwindigkeit, Leistung, HF, Höhe,
Kadenz über Zeit oder Distanz mit Fadenkreuz und Bereichsauswahl (Ziehen →
Auswertung des Bereichs, Markierung auf der Karte), km-Splits mit GAP,
Runden, HF-/Leistungs-/Pacezonen, Mean-Max-Kurve gegen die besten 90 Tage
davor; beim Schwimmen Intervalle und Bahnen mit SWOLF, beim Krafttraining
die Sätze.

Filter nach Sportart (oben) gilt für alle Ansichten. Hell/Dunkel folgt dem
System, umschaltbar.

## Einrichtung (einmalig, Windows)

    cd training\sync
    py -m pip install -r requirements.txt
    copy config.example.json config.json      (anpassen, siehe unten)
    py training_sync.py garmin

Beim ersten Lauf fragt das Skript nach Garmin-E-Mail, Passwort, ggf.
MFA-Code und einer **Passphrase für die Daten** (zweimal). Die
Garmin-Tokens liegen danach in `~/.garminconnect`, weitere Läufe brauchen
kein Passwort mehr. Die Passphrase wird nicht gespeichert; für
unbeaufsichtigte Läufe kann sie in der Umgebungsvariable
`TRAINING_PASSPHRASE` stehen.

Der erste Lauf lädt die **gesamte Historie** (jede Aktivität einzeln, mit
kurzer Pause dazwischen). Alternativ oder zusätzlich: Garmins
Gesamtexport (Garmin-Konto → Datenverwaltung → Daten exportieren; Menübezeichnung nicht geprüft) als ZIP
einlesen — Aktivitätsnamen werden aus dem Export übernommen, soweit
vorhanden:

    py training_sync.py import C:\Users\...\Downloads\garmin_export.zip

Danach regelmäßig:

    py training_sync.py garmin --push

`--push` committet `training/data/` und pusht. Ohne `--push` bleibt es
lokal, man committet selbst.

### config.json

| Schlüssel | Bedeutung |
|---|---|
| `raw_dir` | Original-FIT-Dateien, Cache, Namen — **außerhalb des Repos**, Standard `~/garmin-training` |
| `out_dir` | Ausgabe, relativ zur config: `../data` |
| `mode` | `encrypted` (Standard) oder `plain` (nur für einen Server mit Login, siehe unten) |
| `privacy_zones` | Liste `{lat, lon, radius_m}`: GPS-Punkte darin werden **vor** dem Verschlüsseln entfernt |
| `thresholds` | Liste von Schwellenwerten mit Gültigkeitsbeginn `from` (siehe unten) |
| `exclude` | Aktivitäts-IDs (`YYYYMMDDTHHMMSS`), die nicht erscheinen sollen |

`config.json` steht in `.gitignore` — sie enthält mit den Privatzonen die
Wohnadresse.

Schwellenwerte gelten ab ihrem Datum bis zum nächsten Eintrag; fehlende
Felder werden vom vorigen Eintrag bzw. von einer Schätzung übernommen:

    "thresholds": [
      {"from": "2025-01-01", "ftp": 240, "lthr": 168, "hr_max": 190, "hr_rest": 48,
       "run_pace": "4:45", "swim_css": "1:50", "weight": 70},
      {"from": "2026-05-01", "ftp": 255, "run_pace": "4:35"}
    ]

`run_pace` ist die Schwellenpace pro km, `swim_css` die Critical Swim Speed
pro 100 m. Nach einer Änderung genügt `py training_sync.py build --push`;
es wird nur der Index neu geschrieben, weil alle schwellenabhängigen Größen
(TSS, IF, Zonen) erst im Browser berechnet werden.

## Datenschutz

### Was öffentlich ist

GitHub Pages liefert alles aus, was im Repo liegt. Öffentlich sichtbar sind
daher:

- das Programm,
- `data/manifest.json` (Format, KDF-Parameter, Salt),
- Anzahl und Größe der verschlüsselten Dateien, Commit-Zeitpunkte.

Die Dateinamen unter `data/a/` sind HMAC-Werte der Aktivitäts-ID mit einem
aus der Passphrase abgeleiteten Schlüssel; Datum und Uhrzeit sind daraus
nicht ablesbar. Die **Dateigröße** korreliert grob mit der Dauer.

### Verschlüsselung

- Schlüssel: PBKDF2-HMAC-SHA256, 600 000 Iterationen, 16 Byte Salt, 64 Byte
  Ausgabe (32 Byte AES-Schlüssel, 32 Byte HMAC-Schlüssel für Dateinamen).
- Jede Datei: `"LKT1"` ‖ Nonce (12 Byte, zufällig) ‖ AES-256-GCM(gzip(JSON)),
  Associated Data `"LKT1|<Dateiname>"` (Dateien lassen sich nicht unbemerkt
  vertauschen).
- Im Browser wird der Schlüssel per WebCrypto abgeleitet und, falls
  „Auf diesem Gerät merken“ gewählt ist, als **nicht exportierbarer**
  `CryptoKey` in IndexedDB abgelegt. „Sperren“ löscht ihn.

Angriffsmodell ist Offline-Brute-Force auf die Passphrase (die Rechnung
dazu steht in der Kalender-Doku im Projekt): eine 5-Wort-Diceware-Passphrase
reicht. Ein einmal kopiertes Chiffrat bleibt dauerhaft angreifbar, auch
nachdem es aus dem Repo entfernt wurde — die Git-Historie behält es.

Die Karte lädt Kacheln von `tile.openstreetmap.org`; der Kachelserver sieht
dabei, welcher Ausschnitt betrachtet wird.

### Wechsel auf den Server

Die Seite unterscheidet die Modi allein über die Kennung der Dateien; am
Code ändert sich nichts.

1. Server mit HTTPS und Login (Basic Auth o. Ä.) für `/training/`, z. B. nginx:

        location /training/ {
            auth_basic "Training";
            auth_basic_user_file /etc/nginx/htpasswd-training;
        }

2. `out_dir` auf das vom Server ausgelieferte Verzeichnis setzen (nicht in
   ein Repo mit GitHub-Remote). Dann entweder `mode` auf `plain` (keine
   Passphrase mehr im Browser) oder `encrypted` lassen (doppelte Sicherung).
   Im Modus `plain` verweigert das Skript das Schreiben, wenn `out_dir` in
   einem Repo mit GitHub/GitLab-Remote liegt.
3. `training/data/` aus dem GitHub-Repo löschen. Aus der Historie
   verschwindet das Chiffrat nur mit `git filter-repo` und Force-Push.

## Kennzahlen

Status: (a) Standarddefinition, (b) eigene Wahl/Annäherung.

| Größe | Definition | Status |
|---|---|---|
| NP | 30-s-gleitendes Mittel der Leistung, 4. Potenzmittel, über die Bewegungszeit | (a) Coggan |
| IF, TSS (Rad) | IF = NP/FTP, TSS = h · IF² · 100 | (a) |
| GAP | Geschwindigkeit · C(i)/C(0), C = Minetti-Polynom (J Appl Physiol 2002), Steigung über ±10 s geglättet, Betrag ≤ 45 % | (b) — Strava und TrainingPeaks nutzen eigene, nicht veröffentlichte Modelle |
| NGP | NP-Verfahren auf GAP angewandt | (b) |
| rTSS | h · (NGP/Schwellengeschwindigkeit)² · 100 | (a) Form, (b) wegen NGP |
| sTSS | h · (v/CSS)³ · 100 | (a) |
| hrTSS | Banister-TRIMP, normiert auf 60 min an der LTHR = 100 | (b) — TrainingPeaks' hrTSS ist nicht offengelegt |
| CTL / ATL | EWMA des Tages-TSS, Faktor 1 − e^(−1/τ), τ = 42 / 7 Tage | (a) |
| TSB | CTL − ATL des Vortags | (a) |
| HF-Zonen | Friel, % LTHR: < 85, 85–89, 90–94, 95–99, ≥ 100 | (a) Z5a–c zusammengefasst |
| Leistungszonen | Coggan, % FTP: 55, 75, 90, 105, 120, 150 | (a) |
| Pacezonen | Anteil der Schwellengeschwindigkeit: 77,5 / 87,7 / 94,3 / 101 % | (b) an Friel angelehnt |
| Pa:HR / Pw:HR | (EF₁ − EF₂)/EF₁ über die zwei Hälften der Bewegungszeit | (a) |
| Bestzeiten | kürzester zusammenhängender Abschnitt ≥ Distanz, Bewegungszeit | (b) Strava nutzt ähnlich, Details offen |

Schätzungen ohne Eintrag in der config (grob): FTP ≈ 0,95 · beste
20-min-Leistung; LTHR ≈ beste 20-min-HF (Rad/Lauf); CSS = 200/(t₄₀₀ − t₂₀₀)
aus den Bestzeiten; alles aus den letzten 12 Monaten.

Pausen: Lücken > 12 s zwischen Datenpunkten gelten als Pause und fallen aus
der Bewegungszeit; kürzere (Smart Recording) werden linear interpoliert,
Leistung wird gehalten.

## Bekannte Grenzen

- **Getestet nur mit synthetischen FIT-Dateien** (per `fit-tool` erzeugt,
  mit Smart Recording, Pausen, Runden, Bahnen, Sätzen). Gegen echte Dateien
  der Uhr ist das noch zu verifizieren — besonders Laufkadenz
  (FIT speichert Schritte eines Beins), Schwimmbahnen und Sätze.
- Garmins Aktivitätsnamen kommen nur über `garmin` bzw. den Gesamtexport;
  einzeln importierte FIT-Dateien bekommen Namen wie „Morgenlauf“.
- GPX/TCX werden nicht gelesen (FIT enthält alles Nötige).
- `garminconnect` ist eine inoffizielle Bibliothek; Garmin hat im Frühjahr
  2026 die Anmeldung geändert, was ältere Versionen brach. Bei
  Anmeldefehlern zuerst `py -m pip install -U garminconnect`.
- Manuell in Garmin Connect angelegte Aktivitäten (ohne Datei) fehlen.
