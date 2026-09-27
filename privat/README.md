# /privat

Passwortgeschützte Einstiegsseite. Ausgeliefert werden nur Programm und
Chiffrat (`inhalt.enc.json`); der Klartext `quelle.html` steht in `.gitignore`.

    pip install cryptography
    python privat/build.py            # quelle.html  -> inhalt.enc.json
    python privat/build.py --decrypt  # inhalt.enc.json -> quelle.html

Format: PBKDF2-SHA256 (600 000 It., Salt 16 B) -> AES-256-GCM,
AAD `leopoldkarl.com/privat|v1`. „Auf diesem Gerät merken“ speichert den
abgeleiteten Schlüssel als nicht exportierbaren CryptoKey in IndexedDB,
„Sperren“ löscht ihn. Jeder Neuaufbau erzeugt neues Salt → gemerkte
Schlüssel verfallen, einmal neu eingeben.

Grenze: geschützt ist nur diese Linkliste. Die verlinkten Seiten selbst
sind auf GitHub Pages weiterhin öffentlich abrufbar, wer den Pfad kennt.
