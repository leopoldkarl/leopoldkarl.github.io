# Finanzen unter leopoldkarl.com/finanzen

Einnahmen-/Ausgabenrechnung und Vermögensübersicht (Nachfolger von EAR.xlsx).
Nur über /privat verlinkt, `noindex`, kein Analytics.

## Schutz

* Alle Finanzdaten liegen **nur verschlüsselt** vor: lokal im localStorage
  (`finanzen.vault`) und beim Worker (`/s/finanzen`). Ohne Passphrase oder
  gemerkten Schlüssel zeigt die Seite nur die Sperre.
* PBKDF2-SHA-256 (600 000 It., Salz 16 B, Passphrase NFC) -> AES-256-GCM,
  Blockformat aus `/kalender/js/crypto.js`. Mindestlänge 12 Zeichen.
* „Auf diesem Gerät merken“: nicht exportierbarer CryptoKey in IndexedDB
  „finanzen“. „Sperren“ (Menü) löscht ihn.
* Konfliktsicherungen (`finanzen.conflict.*`) sind ebenfalls Chiffrat.
* Unverschlüsselt ist nur der **Export** (Menü → Export) — die Datei nicht im
  Repo oder in Cloud-Ordnern liegen lassen.
* Grenzen: wer den entsperrten Browser bedient, sieht alles; der Server kann
  eine ältere gültige Fassung zurückspielen (GCM erkennt Fälschung, nicht Alter);
  Passphrase vergessen = Daten weg (Export als Rückfall).

## Datenmodell (`js/model.js`)

    Konto   { id, name, currency: EUR|CHF, kind, slot, archived, order }
    Eintrag { id, seq, date, type, title, details, lines }
      buchung    [{acc, amt}]                 Einnahme > 0, Ausgabe < 0
      umbuchung  [{acc, amt<0}, {acc, amt>0}]  bei Währungswechsel beide Beträge
      stand      [{acc, bal}]                 festgestellter Kontostand
    Kurs    { date, chfPerEur }               1 EUR = x CHF

Beträge in ganzen Cent/Rappen. Reihenfolge: Datum, dann `seq` (Eingabe).
Ein `stand` setzt den Saldo; die Differenz zum fortgeschriebenen Saldo ist
seine Abweichung (beim Depot: Kursentwicklung). Die erste Feststellung eines
Kontos gilt als Anfangsbestand.

Monatsrechnung (EUR, Kurs des Tages): Ende = Anfang + Anfangsbestände +
Einnahmen − Ausgaben + Bewertung + Kurs/Rest; „Kurs“ ist die Restgröße
(Wechselkurseffekt auf CHF-Bestände, Rundung) und wird so definiert, dass die
Gleichung exakt aufgeht.

Zuordnung zu EAR.xlsx: Bankeinnahme/-ausgabe AT/CH und Bargeld -> Buchung;
Verschiebung CH -> Sparkonto und Flatex-Ein-/Auszahlung -> Umbuchung;
„Einstand“-Zeilen und Entwicklung Flatex -> Kontostand; Titel = Kategorie
(Auswertung nach Titel).

## Abgleich

Worker aus `kalender/worker`, Namensraum `finanzen` (in `SPACES` ergänzt;
nach Änderung `npx.cmd wrangler deploy`). Prüfung ohne Token:
`<Worker>/s/finanzen/version` -> 401; 404 hieße alter Worker.
Einrichten: Menü -> Abgleich. Ist der Server leer, lädt das Gerät seinen Stand
hoch (keine Passphrase nötig). Liegt dort schon ein Block, gilt dessen Salz:
Passphrase eingeben, Serverstand wird übernommen, der lokale bleibt als
verschlüsselte Sicherung. Weiteres Gerät: auf der Sperrseite „Vom Server holen“.

## Wechselkurs

Wöchentlich automatisch: die GitHub-Action `.github/workflows/wechselkurs.yml`
(Samstag 07:17 UTC, zusätzlich von Hand über „Run workflow“) ruft
`finanzen/kurse/oenb_kurs.py` auf. Das Skript holt aus dem OeNB-Webservice die
Reihe `VDBKUREFEURCHF` (Referenzkurse der EZB EUR-CHF, Hierarchie 2503,
<https://www.oenb.at/isadataservice/data?lang=DE&hierid=2503&pos=VDBKUREFEURCHF&freq=D&starttime=…>)
und schreibt je ISO-Woche den letzten Kurs nach `finanzen/kurse.json`
(öffentlich, nur Marktkurse). Erster Lauf: Wochen ab 1.4.2026.
Einen eigenen „Mittelkurs“ veröffentlicht die OeNB seit der Euro-Einführung
nicht mehr; sie gibt den EZB-Referenzkurs weiter.

Die Seite liest `kurse.json` (Pages-Kopie und raw.githubusercontent.com) nach
dem Entsperren — bei eingerichtetem Abgleich erst nach dem ersten Abruf vom
Worker — und beim Zurückkehren in den Tab (höchstens stündlich). Neue Kurse
landen mit `src: 'oenb'` im verschlüsselten Bestand und reisen über den
Abgleich auf die anderen Geräte. Eigene Kurse am selben Tag haben Vorrang;
gelöschte OeNB-Kurse stehen in `rateSkips` und kommen nicht wieder.

Zusätzlich im Kursdialog: „Referenzkurs der EZB holen“ über
`api.frankfurter.dev` (überträgt nur das Datum; nicht verifiziert).

## Aufbau

    index.html, finanzen.css
    js/model.js   Modell, Beträge, Salden, Monats- und Titelauswertung (rein)
    js/vault.js   lokales Chiffrat, Schlüsselableitung, IndexedDB
    js/store.js   Zustand, verschlüsseltes Schreiben (Kette), Undo, 2. Fenster
    js/sync.js    abgeleitet aus /projekte/js/sync.js, Pfad /s/finanzen
    js/views.js   Übersicht (Diagramm), Buchungen, Auswertung, Konten
    js/app.js     Sperre, Hash-Router, Dialoge

Tastatur: N = neuer Eintrag, K = Kontostand, Strg+Z = rückgängig.
