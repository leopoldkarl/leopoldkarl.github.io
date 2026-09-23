# Kalender, Aufgaben, Tagebuch

Drei Seiten unter `/kalender/`, umschaltbar über die Reiter oben links oder
die Tasten `1` `2` `3`. Die Seite steht im URL-Fragment (`#kalender`,
`#aufgaben`, `#tagebuch`), ist also lesezeichenfähig und übersteht ein
Neuladen.

Von der Hauptseite **nicht** verlinkt, `noindex` gesetzt, kein
Analytics-Skript eingebunden (sonst stünde der Pfad in einem fremden
Dashboard).

## Stand der Dinge

Die Daten liegen ausschließlich im `localStorage` des jeweiligen Browsers.
Daraus folgt dreierlei, und zwar unabhängig voneinander:

1. **Kein Sync.** Laptop und Handy sehen verschiedene Kalender, Aufgaben
   und Tagebücher.
2. **Kein Zugriffsschutz nötig — noch nicht.** Die ausgelieferten Dateien
   enthalten keine Daten, sondern nur das Programm. Wer die URL kennt,
   sieht eine leere App. Ein Passwort schützt derzeit also nichts, was
   nicht ohnehin schon öffentlich wäre. Mit dem Tagebuch steigt allerdings,
   was auf dem Spiel steht, sobald eine Server-Persistenz dazukommt.
3. **Kein Backup.** Gelöschte Browserdaten bedeuten gelöschte Termine.
   Der Export im Menü (⋯) ist die einzige Sicherung.

Sobald eine Persistenz auf einem Server dazukommt, kehrt sich Punkt 2 um:
dann liegen echte Daten hinter der URL und der Zugriffsschutz wird zur
Voraussetzung, nicht zur Option.

## Aufbau

    index.html        Markup, Dialoge
    kalender.css      Design-Tokens (identisch zu /styles.css) + Layout
    js/dates.js       Datums-Helfer, lokale Wanduhrzeit ohne UTC-Umrechnung
    js/store.js       Zustand + Adapter-Interface
    js/recurrence.js  Expansion der Wiederholungsregeln
    js/ics.js         iCalendar-Export/Import
    js/contacts.js    Geburtsdaten aus Google-CSV- und vCard-Exporten
    js/views.js       reine Render-Funktionen der Kalenderansichten
    js/tasks.js       Aufgabenseite: Ansichten und Zeigergesten
    js/journal.js     Tagebuchseite: Feldtypen, Summen, Layout
    js/app.js         Controller: Seitenwechsel, Navigation, Dialoge

Keine Abhängigkeiten, keine Build-Kette. ES-Module, direkt aus dem Repo
ausgeliefert (`.nojekyll` ist gesetzt).

## Die Naht für später

`store.js` spricht die Persistenz ausschließlich über zwei Methoden an:

    load()  -> Promise<state|null>
    save(s) -> Promise<boolean>

`LocalStorageAdapter` implementiert sie. Ein Server-Adapter — Backend auf
einem eigenen Rechner, Cloudflare Worker, was auch immer — implementiert
dieselben zwei Methoden, und im übrigen Code ändert sich nichts. Was ein
solcher Adapter zusätzlich braucht und was `LocalStorageAdapter` nicht
leistet:

- **Konfliktbehandlung.** Zwei Geräte, die denselben Zustand schreiben,
  überschreiben einander. Nötig ist mindestens ein Versionsstempel pro
  Datensatz und eine Regel, was bei Kollision gewinnt.
- **Teilsynchronisation.** `save()` schreibt derzeit den gesamten Zustand.
  Bei wachsender Datenmenge sollte das auf einzelne Termine umgestellt
  werden.

## Bedienung

**Kategorien** ändern: Menü (⋯) → „Kategorien bearbeiten". Name und Farbe
wirken sofort auf alle Termine. Beim Löschen wandern die betroffenen Termine
nach „Sonstiges"; diese eine Kategorie ist deshalb das Auffangbecken und
nicht löschbar. Alles rückgängig mit `Strg+Z`.

**Datum und Uhrzeit** sind reine Textfelder, kein `<input type="date">`.
Grund: das native Feld zerfällt in Teilfelder für Tag, Monat und Jahr mit je
eigenem Tab-Halt und bringt ein Kalendersymbol mit — für Tastatureingabe ist
beides im Weg. So ist jedes Feld genau ein Tab-Halt und die Reihenfolge lautet
Datum → Von → Bis → Kategorie.

Erkannt werden `23.09.2026`, `23.9.`, `23.9.26`, `2309`, `230926`, `23092026`,
`2026-09-23`, dazu `h`/`heute`, `m`/`morgen`, `g`/`gestern` und `+7`/`-1`.
Uhrzeit: `9`, `915`, `1415`, `14:15`, `14.15`. Beim Verlassen des Feldes wird
auf die kanonische Schreibweise normalisiert; was nicht lesbar ist, wird rot
markiert und **nicht** geraten — der Dialog bleibt dann offen.

## Aufgabenseite

Aufgaben haben **keine Uhrzeit**. Es sind dieselben Aufgaben wie in der
Seitenleiste der Kalenderseite — ein Datenbestand, zwei Zugänge. In der
Kalenderansicht selbst erscheinen sie bewusst nicht.

Zwei Zeigergesten, die nicht dasselbe tun:

- **Block ziehen** ändert die *Reihenfolge* — innerhalb eines Tages und in
  der Wochenansicht auch über Tagesgrenzen hinweg. Die Reihenfolge ist die
  geplante Abarbeitungsfolge.
- **Unteren Rand ziehen** ändert die *Höhe am Bildschirm*, gespeichert in
  `task.height` (34–400 px, in 2-px-Schritten). Die Höhe ist das Gewicht,
  das die Aufgabe bekommt; sie hat keine weitere Bedeutung für die Logik.

Erledigte Aufgaben stehen immer unter den offenen. Das erzwingt die
Sortierung beim Zeichnen (`(a.done - b.done) || (a.order - b.order)`), nicht
die abgelegte Reihenfolge — abhaken und wieder freigeben lässt eine Aufgabe
also an ihren alten Platz zurückkehren.

## Tagebuchseite

Pro Tag: automatisch die Termine des Tages und die erledigten Aufgaben, dazu
die Datenfelder und ein Freitextfeld. Die Feldliste steht als
`journalSchema` im Zustand, nicht im Code — sie wandert damit in die
Sicherung, und ein neues Feld ist ein Eintrag in `DEFAULT_JOURNAL_SCHEMA`.
Neue Standardfelder werden bestehenden Ständen beim Laden nachgetragen.

Feldtypen: `number` (Zahl mit Einheit), `scale5` (1–5, nochmaliges Tippen
löscht), `bool` (dreistufig: leer → ja → nein → leer), `text`, `numtext`
(Minutenzahl **und** eigenes Textfeld), `computed`.

Zwei Felder sind berechnet und deshalb nicht eingebbar — ein Summenfeld von
Hand zu pflegen führt zwangsläufig zum Auseinanderlaufen:

    Mathezeit = Paper + Forschung + Lehrbuchvortrag + Anki + Lektüre
    Sportzeit = Sporteinheit 1..3 + 15 min (Kraft) + 5 min (Mobilisation)
                                  + 10 min (Dehnen)

**„Projekt" geht bewusst NICHT in die Mathezeit ein**, weil es in der
genannten Formel nicht vorkam. Falls das ein Versehen war, ist es eine Zeile
in `journal.js`.

Eingaben werden entprellt geschrieben (400 ms für Felder, 500 ms für den
Freitext) und beim Verlassen des Feldes sofort. Das Datum wird beim Tippen
festgehalten, nicht beim Schreiben — sonst landete eine noch offene Eingabe
im falschen Tag, wenn man inzwischen weiterblättert.

## Geburtstage aus Kontakten

Menü (⋯) → „Kontakt-Export wählen". Frisst Google CSV, andere CSV-Exporte mit
erkennbarer Geburtstags-Spalte, und vCard 3.0/4.0. Vor dem Schreiben kommt
eine Vorschau; nichts wird ohne Bestätigung angelegt, und `Strg+Z` macht den
Import rückgängig.

Was der Parser leistet:

- CSV nach RFC 4180 (Anführungszeichen, Kommas und Umbrüche im Feld),
  Trennzeichen-Erkennung (`,` `;` Tab), BOM- und UTF-16-Erkennung.
- Namen aus `Name` oder aus `First/Middle/Last Name`, ersatzweise `Organization`.
- vCard mit Zeilenfaltung, `FN`/`N`/`ORG`, `X-APPLE-OMIT-YEAR`.
- Datumsformen: `YYYY-MM-DD`, `YYYYMMDD`, `--MM-DD`, `--MMDD`, `TT.MM.JJJJ`,
  `TT.MM.`, und Schrägstrich-Notation **nur wenn eindeutig**.

Was er bewusst nicht leistet: `03/04/2001` wird nicht geraten. Solche Zeilen
erscheinen in der Vorschau als „mehrdeutig" und werden übersprungen.

Angelegt wird je Kontakt ein jährlicher ganztägiger Termin in der Kategorie
`geburtstag`. Die ID ist deterministisch aus Name und Datum abgeleitet, ein
zweiter Import verdoppelt also nicht, sondern meldet die Duplikate.

Zwei Entwurfsentscheidungen:

- **Alter.** Steht nicht im Titel, sondern wird beim Rendern aus `birthYear`
  und dem Jahr der jeweiligen Instanz berechnet. Im Titel wäre es für jedes
  Jahr außer einem falsch. Im ics-Export reist es als `X-BIRTH-YEAR` mit,
  das fremde Kalender ignorieren.
- **29. Februar.** Das Flag `rrule.leapFallback` klemmt den Tag in
  Nicht-Schaltjahren auf den 28. Ohne das Flag gilt weiter RFC 5545, wo
  die Instanz schlicht ausfällt.

## Bewusste Vereinfachungen

- **Zeitzonen.** Alle Zeitpunkte sind Wanduhrzeit des Geräts, ohne
  Zeitzonen-Angabe. Das vermeidet die gesamte UTC/DST-Fehlerklasse, heißt
  aber: auf Reisen verschieben sich Termine nicht mit.
- **RRULE.** Implementiert sind `FREQ` (DAILY/WEEKLY/MONTHLY/YEARLY),
  `INTERVAL`, `BYDAY` (nur bei WEEKLY), `COUNT`, `UNTIL`, `EXDATE`.
  Nicht implementiert: `BYMONTHDAY`, `BYSETPOS`, `BYMONTH`, positionale
  BYDAY-Angaben wie `-1SU`, mehrere `RRULE`s, `RDATE`, `WKST != MO`.
  Beim Import werden nicht interpretierbare Komponenten gezählt und
  gemeldet, nicht stillschweigend verschluckt.
- **Serientermine.** Eine einzelne Instanz zu verschieben oder zu ändern
  löst sie aus der Serie (`EXDATE` + eigenständiger Termin) statt einen
  Override-Mechanismus einzuführen. Das ist verlustfrei, erzeugt aber mit
  der Zeit lose Einzeltermine.
- **`COUNT` und `EXDATE`.** Eine ausgenommene Instanz verbraucht einen
  Zählschritt. Das entspricht RFC 5545 und ist nicht dasselbe wie
  „COUNT sichtbare Termine".

## Tests

Nicht Teil des Repos. Geprüft wurden 85 Einheitentests (Wiederholungsregeln,
ics-Roundtrip inklusive Zeilenfaltung und Maskierung, RECURRENCE-ID-Auflösung,
CSV-/vCard-Parser, Tastatureingabe von Datum und Uhrzeit, Schaltjahr-Rückfall)
und 51 Browsertests (Rendern, Dialoge, Drag & Drop, Rückgängig, Export,
Geburtstags-Import, Kategorien-Editor, Tab-Reihenfolge, Scrollbalken,
Seitenwechsel, Aufgaben-Reihenfolge und -Höhe, Tagebuch-Summen und
-Speicherung, schmale Fenster).
