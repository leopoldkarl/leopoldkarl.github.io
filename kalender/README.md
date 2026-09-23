# Kalender

Eigenständige Kalender-App unter `/kalender/`. Von der Hauptseite **nicht**
verlinkt, `noindex` gesetzt, kein Analytics-Skript eingebunden (sonst stünde
der Pfad in einem fremden Dashboard).

## Stand der Dinge

Die Daten liegen ausschließlich im `localStorage` des jeweiligen Browsers.
Daraus folgt dreierlei, und zwar unabhängig voneinander:

1. **Kein Sync.** Laptop und Handy sehen verschiedene Kalender.
2. **Kein Zugriffsschutz nötig — noch nicht.** Die ausgelieferten Dateien
   enthalten keine Termine, sondern nur das Programm. Wer die URL kennt,
   sieht einen leeren Kalender. Ein Passwort schützt derzeit also nichts,
   was nicht ohnehin schon öffentlich wäre.
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
    js/views.js       reine Render-Funktionen
    js/app.js         Controller: Navigation, Dialoge, Drag & Drop

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
und 28 Browsertests (Rendern, Dialoge, Drag & Drop, Rückgängig, Export,
Geburtstags-Import, Kategorien-Editor, Tab-Reihenfolge, Scrollbalken,
schmale Fenster).
