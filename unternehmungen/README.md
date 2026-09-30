# /unternehmungen

Passwortgeschützte Liste der Unternehmungen — gleiche Bauart wie `/privat`.
Ausgeliefert werden nur Programm und Chiffrat (`inhalt.enc.json`); der
Klartext `quelle.html` steht in `.gitignore` und darf nie committet werden.

Nach jeder Änderung an `quelle.html` neu verschlüsseln (aus dem Repo-Wurzelverzeichnis):

    python privat/build.py --src unternehmungen/quelle.html \
        --out unternehmungen/inhalt.enc.json \
        --aad "leopoldkarl.com/unternehmungen|v1"

Zurück zum Klartext, etwa auf einem zweiten Rechner:

    python privat/build.py --decrypt --src unternehmungen/inhalt.enc.json \
        --out unternehmungen/quelle.html \
        --aad "leopoldkarl.com/unternehmungen|v1"

Format: PBKDF2-SHA256 (600 000 It., Salt 16 B) -> AES-256-GCM, AAD
`leopoldkarl.com/unternehmungen|v1`. Die Passphrase ist dieselbe wie bei
`/privat`; der eigene AAD und das eigene Salz sorgen dafür, dass die beiden
Chiffrate nichts voneinander verraten und ein gemerkter Schlüssel der einen
Seite nicht auf der anderen passt.

„Auf diesem Gerät merken" legt den abgeleiteten Schlüssel als nicht
exportierbaren CryptoKey in der IndexedDB `unternehmungen` ab, „Sperren"
löscht ihn. Jeder Neuaufbau erzeugt ein neues Salz, gemerkte Schlüssel
verfallen dann und die Passphrase ist einmal neu einzugeben.

Grenze: geschützt ist diese Liste. Die verlinkten Seiten selbst — etwa
`/radWEandermatt/` — bleiben öffentlich abrufbar, wer den Pfad kennt.
