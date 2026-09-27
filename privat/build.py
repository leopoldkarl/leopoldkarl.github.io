#!/usr/bin/env python3
"""Verschluesselt privat/quelle.html nach privat/inhalt.enc.json.

    python privat/build.py              # quelle.html -> inhalt.enc.json
    python privat/build.py --decrypt    # inhalt.enc.json -> quelle.html
                                        # (z. B. auf dem zweiten Laptop)

quelle.html ist ein HTML-Fragment (kein <html>/<head>), steht in .gitignore
und darf nie committet werden. Die Passphrase wird interaktiv abgefragt
oder aus der Umgebungsvariablen PRIVAT_PASSPHRASE gelesen.

Format v1 (muss zu privat.js passen):
    PBKDF2-HMAC-SHA256(NFC(Passphrase), salt 16 B, 600 000 Iterationen) -> 32 B
    AES-256-GCM, Nonce 12 B, AAD = b"leopoldkarl.com/privat|v1"
Benoetigt: pip install cryptography   (steht schon in training/sync/requirements.txt)
"""
import argparse, base64, getpass, json, os, secrets, sys, unicodedata
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HERE = Path(__file__).resolve().parent
AAD = b"leopoldkarl.com/privat|v1"
ITERATIONS = 600_000
MIN_LEN = 16

b64e = lambda b: base64.b64encode(b).decode("ascii")
b64d = base64.b64decode


def derive(passphrase: str, salt: bytes, iterations: int) -> bytes:
    pw = unicodedata.normalize("NFC", passphrase).encode("utf-8")
    return PBKDF2HMAC(hashes.SHA256(), 32, salt, iterations).derive(pw)


def ask(confirm: bool) -> str:
    env = os.environ.get("PRIVAT_PASSPHRASE")
    if env:
        return env
    pw = getpass.getpass("Passphrase: ")
    if confirm:
        if len(pw) < MIN_LEN:
            sys.exit(f"Abbruch: mindestens {MIN_LEN} Zeichen (besser 5 Diceware-Woerter).")
        if getpass.getpass("Wiederholen: ") != pw:
            sys.exit("Abbruch: Eingaben stimmen nicht ueberein.")
    return pw


def encrypt(src: Path, out: Path) -> None:
    if not src.exists():
        sys.exit(f"{src} fehlt. Ggf. zuerst --decrypt ausfuehren.")
    pt = src.read_text(encoding="utf-8").encode("utf-8")
    pw = ask(confirm=True)
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    ct = AESGCM(derive(pw, salt, ITERATIONS)).encrypt(iv, pt, AAD)
    blob = {"v": 1,
            "kdf": {"alg": "PBKDF2-SHA256", "iterations": ITERATIONS, "salt": b64e(salt)},
            "iv": b64e(iv), "ct": b64e(ct)}
    out.write_text(json.dumps(blob, indent=1) + "\n", encoding="utf-8")
    print(f"geschrieben: {out}  ({len(pt)} B Klartext)")


def decrypt(src: Path, out: Path) -> None:
    blob = json.loads(src.read_text(encoding="utf-8"))
    if blob.get("v") != 1:
        sys.exit("Unbekannte Formatversion.")
    k = blob["kdf"]
    key = derive(ask(confirm=False), b64d(k["salt"]), k["iterations"])
    try:
        pt = AESGCM(key).decrypt(b64d(blob["iv"]), b64d(blob["ct"]), AAD)
    except Exception:
        sys.exit("Falsche Passphrase oder beschaedigte Datei.")
    if out.exists() and input(f"{out} ueberschreiben? [j/N] ").strip().lower() != "j":
        sys.exit("Abbruch.")
    out.write_text(pt.decode("utf-8"), encoding="utf-8")
    print(f"geschrieben: {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--decrypt", action="store_true")
    ap.add_argument("--src", type=Path)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    if a.decrypt:
        decrypt(a.src or HERE / "inhalt.enc.json", a.out or HERE / "quelle.html")
    else:
        encrypt(a.src or HERE / "quelle.html", a.out or HERE / "inhalt.enc.json")
