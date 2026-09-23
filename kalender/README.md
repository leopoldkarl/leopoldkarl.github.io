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

Nicht Teil des Repos. Geprüft wurden 22 Einheitentests (Wiederholungsregeln,
ics-Roundtrip inklusive Zeilenfaltung und Maskierung) und 14 Browsertests
(Rendern, Dialoge, Drag & Drop, Rückgängig, Export, schmale Fenster).
