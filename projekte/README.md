# Projekte

Fortschritt mehrerer Projekte unter `/projekte/`. Nur über `/privat`
verlinkt, `noindex`, kein Analytics-Skript. Keine Abhängigkeiten, keine
Build-Kette; ES-Module direkt aus dem Repo.

    index.html      Markup, Dialoge
    projekte.css    Tokens wie /styles.css und /kalender, eigenes Layout
    js/model.js     Datenmodell, Fortschritt, Soll-Kurve, Prognose (rein, ohne DOM)
    js/store.js     Zustand, localStorage, Rückgängig, zweites Fenster
    js/views.js     Render-Funktionen: Übersicht, Detail, Zeitleiste
    js/sync.js      Abgleich mit dem Worker, Namensraum „projekte“
    js/keystore.js  abgeleiteter Schlüssel in IndexedDB (DB „projekte“)
    js/app.js       Router, Ereignisse, Dialoge

Die Verschlüsselung kommt unverändert aus `/kalender/js/crypto.js`
(AES-256-GCM, PBKDF2-HMAC-SHA-256 mit 600 000 Iterationen).

## Modell

    Projekt ─ Meilenstein ─ Aufgabe (Gewicht 1/2/3/5/8, erledigt am …)

**Ist** = erledigtes Gewicht / Gesamtgewicht über alle Aufgaben des
Projekts. Ein Meilenstein ohne Aufgaben zählt selbst als eine Einheit mit
Gewicht 1 und wird direkt abgehakt; sobald er Aufgaben hat, zählen nur
diese.

**Soll** ist stückweise linear: Meilensteine nach Fälligkeit sortiert,
zwischen dem vorigen Datum (bzw. dem Projektbeginn) und dem eigenen wächst
das Soll um das Gewicht des Meilensteins. Ein Meilenstein ohne eigenes
Datum erbt das Projektziel. Fehlt der Beginn, oder hat ein Meilenstein
weder eigenes Datum noch ein Projektziel, gibt es **kein** Soll — dann
wird auch keines angezeigt.

**Abstand** in Tagen: heute minus der erste Tag, an dem das Soll den
heutigen Ist-Wert erreicht. Positiv = Rückstand. Ampel (nur bei Status
„aktiv“): bis 3 Tage im Plan, bis 14 Tage knapp, darüber Verzug; nach dem
Projektziel „Ziel überschritten“.

**Prognose**: lineare Fortschreibung des in den letzten 28 Tagen
erledigten Gewichts. Eine Faustzahl, keine Vorhersage; ohne Erledigtes in
dem Fenster keine Prognose.

Das Burn-up-Diagramm zeigt Ist als Treppe (aus den Erledigt-Daten der
Aufgaben), Soll gestrichelt, Meilensteine als Rauten. Abhaken setzt das
Erledigt-Datum auf heute; wer nachträglich abhakt, verschiebt also den
Ist-Verlauf auf heute. Erledigte Einheiten ohne Datum (etwa aus einem
Import) zählen ab Projektbeginn.

## Tags

Jedes Projekt kann bis zu 20 Tags tragen (je höchstens 40 Zeichen),
eingegeben im Projektdialog, durch Komma oder Semikolon getrennt; ein
führendes `#` wird weggelassen. Groß-/Kleinschreibung zählt beim Vergleich
nicht („Lehre“ = „lehre“), gespeichert wird die zuerst genannte
Schreibweise. Unter dem Feld stehen die schon vorhandenen Tags zum
Anklicken.

Über Übersicht und Zeitleiste liegt eine Tag-Leiste mit Häufigkeiten
(gezählt innerhalb des Statusfilters). Mehrere gewählte Tags werden
geschnitten: gezeigt wird, was **alle** trägt. Ein Tag im Projektdetail
führt zur Übersicht, gefiltert auf genau diesen Tag. Die Auswahl ist eine
Ansichtseinstellung je Gerät (`projekte.ui`), nicht Teil des Datenblocks;
ein neues Projekt übernimmt die gerade gewählten Tags als Vorschlag.

## Bedienung

`N` neues Projekt, `Strg+Z` rückgängig (außerhalb von Textfeldern),
`Esc` im Detail zurück zur Übersicht. Aufgaben: Enter im Feld „Aufgabe
hinzufügen“, Titel direkt im Feld ändern, Gewicht per Klick durchschalten.
Datumsfelder verstehen `27.9.26`, `2709`, `270926`, `2026-09-27`, `h`,
`m`, `+30`, `-3`; Unlesbares wird rot markiert, nicht geraten.

Export/Import (Menü ⋯) als JSON. Import **ersetzt** den Stand und ist
mit `Strg+Z` rückgängig zu machen.

## Abgleich

Derselbe Cloudflare Worker wie der Kalender, aber ein eigener Block:
alle Anfragen gehen an `<Worker>/s/projekte/state` bzw. `/version`. Der
Worker legt dafür eine eigene D1-Zeile (`id = 'projekte'`) mit eigener
Version an; Kalender und Projekte kommen sich nicht in die Quere.

Einrichten: Menü ⋯ → „Abgleich zwischen Geräten“. Adresse und Token
werden aus dem Kalender übernommen, wenn dieser im selben Browser
eingerichtet ist. Die Passphrase darf dieselbe sein wie im Kalender; der
Schlüssel ist trotzdem ein anderer, weil jeder Block sein eigenes Salz hat.

Konfliktregel wie im Kalender: der fremde Stand gewinnt, der eigene
landet als `projekte.conflict.<Zeitstempel>` im localStorage (höchstens
drei).

**Voraussetzung:** der Worker muss die Namensraum-Erweiterung kennen
(`kalender/worker/src/index.js`, Konstante `SPACES`). Solange er nicht neu
ausgerollt ist, antwortet er auf `/s/projekte/…` mit 404 — die Seite meldet
das, statt den Kalenderblock zu lesen oder zu überschreiben. Das ist der
Grund für einen Pfad statt eines Query-Parameters.

    cd kalender/worker
    npx wrangler deploy

Kein Schema-Update nötig: die Tabelle `state` hat schon `id` als
Primärschlüssel.

## Tests

Nicht Teil des Repos. 12 Modelltests (Datumseingabe, Normalisierung, Tags,
Gewichtung, Soll-Kurve samt Umkehrung, Abstand, Ampel, Ist-Verlauf,
Prognose, Sortierung), 21 Worker-Prüfungen (Namensraum getrennt vom
Kalender, 409, unbekannte Namensräume und Pfadvarianten → 404, und der
alte Worker liefert auf `/s/projekte` 404 statt des Kalenderblocks), 51
Browserprüfungen in Chromium (Anlegen, Dialogfehler, Aufgaben mit Fokus,
Gewichte, Umbenennen, Löschen + Rückgängig, Meilenstein ohne Aufgaben,
Diagramm, Filter, Zeitleiste, Reload, zweites Fenster, Einrichtung des
Abgleichs mit Vorbefüllung aus dem Kalender, falsche Passphrase, Abgleich
über zwei Browser-Kontexte, Konflikt, alter Worker, dunkel bei 375 px ohne
Querscrollen, Tags: Normalisierung, Vorschläge, Filter mit UND, Sprung aus dem Detail, Zeitleiste). „Server“ ist dabei der echte Worker-Code mit einer
D1-Attrappe.
