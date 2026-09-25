# Aufgaben, Planung, Tagebuch, Kalender

Fünf Seiten unter `/kalender/`, in dieser Reihenfolge und mit diesen Kürzeln:

    A    Aufgaben
    TP   Tagesplanung
    WP   Wochenplanung
    TB   Tagebuch
    K    Kalender

Umschalten über die Reiter, über `1`…`5`, oder mit `Strg+A` (vorwärts) und
`Strg+⇧+A` (rückwärts). Die Seite steht im URL-Fragment (`#wochenplanung`
usw.), ist also lesezeichenfähig und übersteht ein Neuladen; zuletzt
besuchte Seite wird gemerkt.

`Strg+A` behält in einem Textfeld seine gewohnte Bedeutung „alles
markieren". Die Belegung dort zu überschreiben wäre lästiger als der
Gewinn.

Die rechte Seitenleiste lässt sich über den Knopf ▦ in der Kopfleiste oder
mit `S` aus- und einblenden; der Zustand wird gemerkt. In **allen**
Wochenansichten — Kalender, Aufgaben, Wochenplanung samt Vorlagen-Modus —
teilen sich die sieben Tage immer die volle Breite gleichmäßig auf: mit
eingeblendeter Leiste schmaler, ohne sie breiter, aber nie abgeschnitten
und nie mit waagrechtem Scrollbalken. Nur unter 780 px Fensterbreite gilt
wieder eine Mindestbreite von 150 px je Spalte, weil sieben Spalten darunter
unleserlich würden.

Von der Hauptseite **nicht** verlinkt, `noindex` gesetzt, kein
Analytics-Skript eingebunden (sonst stünde der Pfad in einem fremden
Dashboard).

## Stand der Dinge

Die Daten liegen ausschließlich im `localStorage` des jeweiligen Browsers.
Daraus folgt dreierlei, und zwar unabhängig voneinander:

1. **Kein Sync über Geräte und Browser.** Laptop und Handy sehen
   verschiedene Kalender, Aufgaben und Tagebücher; ebenso zwei verschiedene
   Browser auf demselben Rechner und zwei verschiedene Herkünfte
   (`leopoldkarl.com` und `leopoldkarl.github.io` sind für den Browser
   getrennte Speicher). Mehrere **Fenster desselben Browsers auf derselben
   Herkunft** ziehen dagegen nach: siehe „Mehrere Fenster".
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
    js/plan.js        Tages- und Wochenplanung, Vorlagen
    js/tooltip.js     voller Titel beim Verweilen mit dem Zeiger
    js/app.js         Controller: Seitenwechsel, Navigation, Dialoge

Keine Abhängigkeiten, keine Build-Kette. ES-Module, direkt aus dem Repo
ausgeliefert (`.nojekyll` ist gesetzt).

## Mehrere Fenster

Jedes Fenster hält seine eigene Kopie des Zustands im Arbeitsspeicher und
schreibt beim Speichern den **gesamten** Zustand zurück. Ohne Gegenmaßnahme
folgt daraus nicht nur, dass ein neuer Termin im anderen Fenster unsichtbar
bleibt, sondern dass dessen nächste Änderung den alten Gesamtzustand darüber
schreibt — der Termin wäre weg, und zwar endgültig, weil der Undo-Stapel im
Arbeitsspeicher des jeweiligen Fensters liegt.

Deshalb hört jedes Fenster auf das `storage`-Ereignis des eigenen Schlüssels
(`LocalStorageAdapter.watch`) und übernimmt den fremden Zustand
(`Store.adoptExternal`). Die Regeln dabei:

- **Übernommen wird ohne Zurückschreiben.** Der fremde Zustand steht bereits
  im Speicher; ein Rückschreiben ließe die Fenster gegeneinander schwingen.
  Damit gilt überall dieselbe Regel: der zuletzt geschriebene Zustand gewinnt.
  Verlieren kann man nur eine Änderung aus den letzten 250 ms (Entprellung).
- **Offene Tagebuch-Eingaben werden vorher festgeschrieben**, sonst
  verschluckte die Übernahme das gerade getippte Wort.
- **Der Undo-Stapel wird verworfen.** Seine Schnappschüsse beschreiben einen
  Zustand, den es nicht mehr gibt; ein Strg+Z darauf wäre genau das
  Überschreiben, das hier verhindert werden soll.
- **Während einer laufenden Zeigergeste** wird nicht neu gezeichnet, sondern
  erst beim Loslassen übernommen.

Das `storage`-Ereignis feuert nur in den *anderen* Fenstern, nie im
schreibenden — ein Echo auf die eigene Speicherung gibt es also nicht.

**Die Zustellung ist allerdings nicht lückenlos.** Ein eingefrorener
Hintergrund-Tab (mobil die Regel, am Desktop bei Speicherdruck) oder eine
Seite aus dem Vor-/Zurück-Cache bekommt das Ereignis gar nicht erst und liefe
danach mit veraltetem Stand weiter. Deshalb sieht jedes Fenster bei
`visibilitychange` (sichtbar), `focus` und `pageshow` (aus dem Cache geholt)
im Speicher nach: `LocalStorageAdapter.poll()` vergleicht den Rohtext mit dem
zuletzt selbst geschriebenen oder gesehenen und meldet nur eine echte
Abweichung. Verglichen wird bewusst der Rohtext und nicht
`JSON.stringify(state)` — letzteres hängt an der Schlüsselreihenfolge und
gäbe Fehlalarme, die bei jedem Fensterwechsel den Undo-Stapel löschten.
Eigene, noch nicht gespeicherte Änderungen berühren den Speicherinhalt nicht
und lösen hier folglich nichts aus.

Der Fokus ist dabei nicht redundant: wechselt man zwischen zwei nicht
verdeckten Fenstern desselben Browsers, bleibt die Sichtbarkeit unverändert.

Für verschiedene Browser oder Geräte hilft das alles nicht; dafür braucht es
einen Server-Adapter.

## Die Naht für später

`store.js` spricht die Persistenz ausschließlich über diese Methoden an:

    load()    -> Promise<state|null>
    save(s)   -> Promise<boolean>
    watch(cb) -> unsubscribe        (optional)

`LocalStorageAdapter` implementiert sie. Ein Server-Adapter — Backend auf
einem eigenen Rechner, Cloudflare Worker, was auch immer — implementiert
dieselben Methoden (`watch` dann als Polling oder SSE), und im übrigen Code
ändert sich nichts. Was ein solcher Adapter zusätzlich braucht und was
`LocalStorageAdapter` nicht leistet:

- **Konfliktbehandlung.** Zwei Geräte, die denselben Zustand schreiben,
  überschreiben einander. Nötig ist mindestens ein Versionsstempel pro
  Datensatz und eine Regel, was bei Kollision gewinnt.
- **Teilsynchronisation.** `save()` schreibt derzeit den gesamten Zustand.
  Bei wachsender Datenmenge sollte das auf einzelne Termine umgestellt
  werden.

## Bedienung

**Volle Titel** erscheinen, wenn der Zeiger rund eine Drittelsekunde über
einem Termin (Wochen-, Tages- und Monatsansicht, Ganztags-Leiste, Tagesliste
der Seitenleiste) oder über einem Eintrag der Wochen- und Tagesplanung
verweilt — aber nur dann, wenn der Text tatsächlich abgeschnitten ist. Passt
er in sein Element, bleibt der Kasten aus; sonst wäre jeder Zeigerweg über
den Kalender ein Flackern von Kästen. Das `title`-Attribut leistet das nicht:
seine Verzögerung ist nicht einstellbar, und über einem `<input>` — so sind
die Titel in der Planung umgesetzt — zeigt es den eingegebenen Wert gar
nicht. Auf Touchscreens bleibt die Einblendung aus, dort gibt es kein
Verweilen ohne Berührung. Die Aufgabenseite ist bewusst nicht dabei; sie
nachzuziehen wäre eine Zeile in `initTooltips`.

**Kategorien** ändern: Menü (⋯) → „Kategorien bearbeiten". Name und Farbe
wirken sofort auf alle Termine. Die Schriftfarbe auf ganztägigen Terminen —
der einzigen Stelle, an der Text auf der vollen Kategoriefarbe liegt — wird
je Farbe berechnet (`contrastText` in `views.js`): dunkle Schrift auf hellem
Grund, helle auf dunklem, je nachdem welche nach WCAG 2.1 den höheren
Kontrast hat. Gerechnet wird gegen die tatsächlich verwendeten Tinten
(`#111827` und `#ffffff`), nicht gegen reines Schwarz und Weiß — mit der
idealisierten Formel kippte die Entscheidung bei mittleren Farben wie Indigo
in die falsche Richtung. Ein Haarstrich innen macht sehr helle Flächen
gegen den Untergrund sichtbar. Beim Löschen wandern die betroffenen Termine
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

## Planung: drei Ebenen, jede eine Kopie

    Vorlage  --kopieren-->  Wochenplan  --kopieren-->  Tagesplan
    (versioniert)           (+ Kalendertermine)

Eine Ebene entsteht erst beim **ersten Eingriff**. Solange kein Wochenplan
angelegt ist, zeigt die Wochenplanung eine Vorschau aus Vorlage und
Kalender; solange kein Tagesplan angelegt ist, zeigt die Tagesplanung den
betreffenden Tag aus dem Wochenplan. Ab dem ersten Eingriff ist die Ebene
eigenständig — Änderungen wirken **nie** nach oben. Eine Änderung im
Wochenplan berührt weder Vorlage noch Kalender, eine Änderung im Tagesplan
nicht den Wochenplan.

### Vorlagen sind versioniert

Eine Vorlage wird nie überschrieben. Beim Bearbeiten gilt:

- Stammt die Vorlage von **heute**, wird sie direkt geändert.
- Ist sie **älter**, entsteht zuerst eine Kopie mit dem heutigen Datum, und
  geändert wird die Kopie. Die alte Fassung bleibt in der Auswahlliste.

Also **eine Fassung pro Bearbeitungstag**, nicht eine pro Tastendruck —
sonst hätte man nach einer Sitzung dutzende. Welche Fassung für eine Woche
gilt: die jüngste, deren Datum am Montag der Woche bereits zurückliegt;
über die Auswahlliste auch von Hand.

### Rückwege

- **Kalender übernehmen** zieht neu hinzugekommene Termine in einen bereits
  angelegten Wochenplan nach. Erkannt wird über `srcId` (Termin-ID plus
  Instanzdatum), es entstehen also keine Doppelten; eigene und geänderte
  Einträge bleiben unangetastet.
- **Woche zurücksetzen** und **Wieder aus Wochenplan holen** verwerfen die
  Kopie und schalten wieder auf die darüberliegende Ebene. Beides hängt am
  Rückgängig-Stapel.

Einträge tragen ihre Herkunft: durchgezogener Rand = selbst angelegt,
gestrichelt = aus der Vorlage, eingefärbt = aus dem Kalender.

## Tagebuchseite

Pro Tag: automatisch die Termine des Tages und die erledigten Aufgaben, dazu
die Datenfelder und ein Freitextfeld. Die Feldliste steht als
`journalSchema` im Zustand, nicht im Code — sie wandert damit in die
Sicherung, und ein neues Feld ist ein Eintrag in `DEFAULT_JOURNAL_SCHEMA`.
Neue Standardfelder werden bestehenden Ständen beim Laden nachgetragen.

Feldtypen: `number` (Zahl mit Einheit), `scale5` (1–5, nochmaliges Tippen
löscht), `bool` (dreistufig: leer → ja → nein → leer), `text`, `numtext`
(Minutenzahl **und** eigenes Textfeld), `computed`.

Ein Feld mit `strip: true` steht im Kopfstreifen neben den Gesamtzeiten
statt in der Liste darunter — derzeit „Tagesevent" und „Glücksmoment".

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

Nicht Teil des Repos. Geprüft wurden 116 Einheitentests (Wiederholungsregeln,
ics-Roundtrip inklusive Zeilenfaltung und Maskierung, RECURRENCE-ID-Auflösung,
CSV-/vCard-Parser, Tastatureingabe von Datum und Uhrzeit, Schaltjahr-Rückfall,
ISO-Wochenschlüssel, Vorlagen-Versionierung, Kopier-Isolation, Kontrastwahl)
und 112 Browsertests (Rendern, Dialoge, Drag & Drop, Rückgängig, Export,
Geburtstags-Import, Kategorien-Editor, Tab-Reihenfolge, Scrollbalken,
Seitenwechsel, Aufgaben-Reihenfolge und -Höhe, Tagebuch-Summen und
-Speicherung, Vorlagen-Versionierung und Kopier-Isolation, Seitenleisten-Schalter und
Spaltenbreiten, schmale Fenster, Zwei-Fenster-Abgleich, Titel-Einblendung).
Der Zwei-Fenster-Fall läuft mit zwei echten Seiten in einem Browser-Kontext.
Die Gegenprobe ist Teil des Befunds: schaltet man `adapter.watch` ab, fällt
der Termin des einen Fensters aus dem Speicher, sobald das andere schreibt —
genau der Datenverlust, den diese Prüfungen absichern.
Eine Einschränkung: headless-Chromium liefert beim Wechsel zwischen zwei
Seiten weder `visibilitychange` noch `focus` (`bringToFront` lässt beide
sichtbar und fokussiert, `Page.setWebLifecycleState` feuert nur
`freeze`/`resume`). Geprüft wird dort die Kette Ereignis → `poll()` →
Übernahme mit synthetisch ausgelöstem Ereignis; dass der Browser das Ereignis
im Ernstfall auch schickt, ist nicht mitgeprüft.
Die Versionierung über einen Tageswechsel hinweg wird mit der Browser-Uhr
geprüft, nicht durch Manipulation am `localStorage` — die App schreibt ihren
Stand beim Entladen zurück und würde eine solche Manipulation überschreiben.
