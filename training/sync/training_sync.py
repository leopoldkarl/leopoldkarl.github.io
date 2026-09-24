#!/usr/bin/env python3
"""Trainingsdaten fuer leopoldkarl.com/training.

    python training_sync.py garmin              neue Aktivitaeten aus Garmin Connect holen + build
    python training_sync.py garmin --full       komplette Historie durchgehen
    python training_sync.py import PFAD ...     .fit-Dateien, Ordner oder ZIPs (auch Garmins Gesamtexport)
    python training_sync.py build               Ausgabe neu erzeugen (z.B. nach Aenderung der config)
    python training_sync.py status              Ueberblick ueber Rohdaten und Ausgabe

Optionen: --push (danach git commit + push der Ausgabe), --config PFAD.

Rohdaten (Original-FIT, Cache, Namen) liegen unter ``raw_dir`` AUSSERHALB
des Repos. Ins Repo geht nur ``out_dir`` -- im Modus "encrypted" als
AES-256-GCM-Chiffrat, Schluessel per PBKDF2-SHA256 aus einer Passphrase.
Details: ../README.md
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import datetime as dt
import getpass
import gzip
import hashlib
import hmac
import io
import json
import os
import struct
import subprocess
import sys
import time
import unicodedata
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fitproc  # noqa: E402

FORMAT = "lkt-training"
FORMAT_VERSION = 1
KDF_ITERATIONS = 600_000
MAGIC_ENC = b"LKT1"
MAGIC_PLAIN = b"LKT0"

DEFAULT_CONFIG = {
    "raw_dir": "~/garmin-training",
    "out_dir": "../data",
    "mode": "encrypted",
    "privacy_zones": [],
    "exclude": [],
    "thresholds": [],
    "garmin": {"email": "", "tokenstore": "~/.garminconnect"},
}


# ==========================================================================
# Konfiguration
# ==========================================================================

class Config:
    def __init__(self, path: Path):
        self.path = path
        data = dict(DEFAULT_CONFIG)
        if path.exists():
            with open(path, encoding="utf-8") as f:
                user = json.load(f)
            data.update({k: v for k, v in user.items() if not k.startswith("_")})
        else:
            print(f"Hinweis: {path.name} fehlt, verwende Voreinstellungen "
                  f"(Vorlage: config.example.json).", file=sys.stderr)
        base = path.parent
        self.raw = Path(os.path.expanduser(data["raw_dir"]))
        out = Path(os.path.expanduser(data["out_dir"]))
        self.out = (out if out.is_absolute() else (base / out)).resolve()
        self.mode = data["mode"]
        if self.mode not in ("encrypted", "plain"):
            raise SystemExit(f"mode muss 'encrypted' oder 'plain' sein, nicht {self.mode!r}")
        self.zones = data.get("privacy_zones") or []
        self.exclude = set(data.get("exclude") or [])
        self.thresholds = [_threshold(t) for t in data.get("thresholds") or []]
        self.garmin = {**DEFAULT_CONFIG["garmin"], **(data.get("garmin") or {})}

    @property
    def privacy_hash(self) -> str:
        z = json.dumps(sorted((round(x["lat"], 6), round(x["lon"], 6), x.get("radius_m", 400))
                              for x in self.zones))
        return hashlib.sha256(z.encode()).hexdigest()[:12]


def _pace_to_speed(s, per_m):
    """'4:20' (min:s pro per_m Meter) -> m/s."""
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)):
        sec = float(s)
    else:
        parts = [float(p) for p in str(s).split(":")]
        sec = parts[0] * 60 + parts[1] if len(parts) == 2 else parts[0]
    return round(per_m / sec, 4) if sec > 0 else None


def _threshold(t: dict) -> dict:
    out = {"from": t.get("from", "1970-01-01")}
    for k in ("ftp", "lthr", "hr_max", "hr_rest", "weight", "run_ftp"):
        if t.get(k) not in (None, ""):
            out[k] = float(t[k])
    if t.get("run_pace"):
        out["run_v"] = _pace_to_speed(t["run_pace"], 1000)
    if t.get("swim_css"):
        out["swim_v"] = _pace_to_speed(t["swim_css"], 100)
    dt.date.fromisoformat(out["from"])       # validiert das Datum
    return out


# ==========================================================================
# Rohdatenablage
# ==========================================================================

class RawStore:
    def __init__(self, root: Path):
        self.root = root
        self.fit = root / "fit"
        self.cache = root / "cache"
        for p in (self.fit, self.cache):
            p.mkdir(parents=True, exist_ok=True)
        self.names_path = root / "names.json"
        self.garmin_path = root / "garmin.json"
        self.names = _load_json(self.names_path, {})
        self.garmin = _load_json(self.garmin_path, {"ids": {}})

    def save_meta(self):
        _dump_json(self.names_path, self.names)
        _dump_json(self.garmin_path, self.garmin)

    def add_fit(self, data: bytes) -> tuple[str, bool]:
        key = hashlib.sha256(data).hexdigest()[:20]
        p = self.fit / f"{key}.fit"
        if p.exists():
            return key, False
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(p)
        return key, True

    def keys(self):
        return sorted(p.stem for p in self.fit.glob("*.fit"))


def _load_json(p: Path, default):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def _dump_json(p: Path, obj):
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    tmp.replace(p)


def fit_file_type(data: bytes) -> int | None:
    """Liest nur den file_id-Typ (4 = activity), ohne die Datei zu dekodieren."""
    try:
        hs = data[0]
        if data[8:12] != b".FIT":
            return None
        pos = hs
        defs = {}
        for _ in range(8):
            h = data[pos]
            pos += 1
            if h & 0x80:                                # komprimierter Zeitstempel
                local = (h >> 5) & 0x3
                is_def = False
            else:
                local = h & 0x0F
                is_def = bool(h & 0x40)
            if is_def:
                arch = data[pos + 1]
                gnum = struct.unpack("<H" if arch == 0 else ">H", data[pos + 2:pos + 4])[0]
                nf = data[pos + 4]
                fields = [(data[pos + 5 + 3 * i], data[pos + 6 + 3 * i]) for i in range(nf)]
                pos += 5 + 3 * nf
                dev = 0
                if h & 0x20:
                    nd = data[pos]
                    dev = sum(data[pos + 2 + 3 * i] for i in range(nd))
                    pos += 1 + 3 * nd
                defs[local] = (gnum, fields, dev)
            else:
                gnum, fields, dev = defs[local]
                if gnum == 0:
                    off = pos
                    for num, size in fields:
                        if num == 0:
                            return data[off]
                        off += size
                    return None
                pos += sum(s for _, s in fields) + dev
        return None
    except (IndexError, KeyError, struct.error):
        return None


# ==========================================================================
# Import
# ==========================================================================

def _names_from_json(obj, names: dict):
    """Aktivitaetsnamen aus Garmins Export-JSON (summarizedActivities).
    Das Format ist nicht dokumentiert, daher generisch gesucht."""
    if isinstance(obj, dict):
        name = obj.get("name") or obj.get("activityName")
        ts = obj.get("startTimeGmt") or obj.get("beginTimestamp")
        if isinstance(name, str) and isinstance(ts, (int, float)) and ts > 1e11:
            names[str(int(ts // 1000))] = name
        for v in obj.values():
            _names_from_json(v, names)
    elif isinstance(obj, list):
        for v in obj:
            _names_from_json(v, names)


def import_bytes(store: RawStore, name: str, data: bytes, stats: dict, depth=0):
    low = name.lower()
    if low.endswith(".zip") and depth < 4:
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for info in z.infolist():
                    if info.is_dir():
                        continue
                    n = info.filename.lower()
                    if n.endswith((".fit", ".zip")) or (n.endswith(".json") and "summarizedactivities" in n):
                        import_bytes(store, info.filename, z.read(info), stats, depth + 1)
        except zipfile.BadZipFile:
            stats["fehler"] += 1
            print(f"  kein gueltiges ZIP: {name}", file=sys.stderr)
        return
    if low.endswith(".json"):
        try:
            _names_from_json(json.loads(data.decode("utf-8")), store.names)
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        return
    if low.endswith(".fit"):
        ft = fit_file_type(data)
        if ft is not None and ft != 4:
            stats["keine_aktivitaet"] += 1
            return
        _, new = store.add_fit(data)
        stats["neu" if new else "bekannt"] += 1
        return
    if low.endswith((".gpx", ".tcx")):
        stats["nicht_unterstuetzt"] += 1


def cmd_import(cfg: Config, paths: list[str]):
    store = RawStore(cfg.raw)
    stats = {"neu": 0, "bekannt": 0, "keine_aktivitaet": 0, "nicht_unterstuetzt": 0, "fehler": 0}
    for p in map(Path, paths):
        files = [p] if p.is_file() else sorted(x for x in p.rglob("*") if x.is_file())
        for f in files:
            import_bytes(store, f.name, f.read_bytes(), stats)
    store.save_meta()
    print("Import: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in stats.items() if v))
    if stats["nicht_unterstuetzt"]:
        print("  GPX/TCX werden nicht gelesen -- bitte das Original (FIT) verwenden.")


# ==========================================================================
# Garmin Connect
# ==========================================================================

def cmd_garmin(cfg: Config, full: bool, since: str | None):
    try:
        from garminconnect import Garmin
    except ImportError:
        raise SystemExit("Paket fehlt: pip install -r requirements.txt")
    store = RawStore(cfg.raw)
    tokenstore = os.path.expanduser(cfg.garmin["tokenstore"])
    Path(tokenstore).mkdir(parents=True, exist_ok=True)

    email = os.environ.get("GARMIN_EMAIL") or cfg.garmin.get("email") or None
    api = Garmin(email=email, password=os.environ.get("GARMIN_PASSWORD"),
                 prompt_mfa=lambda: input("Garmin MFA-Code: ").strip())
    try:
        api.login(tokenstore)
    except Exception:
        # keine/abgelaufene Tokens -> interaktiv anmelden
        if not sys.stdin.isatty():
            raise SystemExit("Garmin-Anmeldung noetig, aber keine Konsole fuer die Eingabe. "
                             "Einmal interaktiv ausfuehren.")
        email = email or input("Garmin E-Mail: ").strip()
        api = Garmin(email=email, password=getpass.getpass("Garmin Passwort: "),
                     prompt_mfa=lambda: input("Garmin MFA-Code: ").strip())
        api.login(tokenstore)

    known = store.garmin["ids"]
    since_d = dt.date.fromisoformat(since) if since else None
    todo = []
    start, page = 0, 100
    while True:
        batch = api.get_activities(start, page)
        if not batch:
            break
        new_in_page = 0
        stop = False
        for a in batch:
            aid = str(a.get("activityId"))
            gmt = a.get("startTimeGMT")
            if gmt:
                t = dt.datetime.strptime(gmt, "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc)
                if a.get("activityName"):
                    store.names[str(int(t.timestamp()))] = a["activityName"]
                if since_d and t.date() < since_d:
                    stop = True
                    break
            if aid not in known:
                todo.append(aid)
                new_in_page += 1
        if stop or (not full and new_in_page == 0):
            break
        start += page
    print(f"Garmin: {len(todo)} neue Aktivitaet(en)")
    for n, aid in enumerate(reversed(todo), 1):
        try:
            blob = api.download_activity(aid, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
        except Exception as e:                                  # manuelle Eintraege haben keine Datei
            print(f"  {aid}: kein Original ({type(e).__name__})")
            known[aid] = None
            continue
        keys = []
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                for info in z.infolist():
                    if info.filename.lower().endswith(".fit"):
                        keys.append(store.add_fit(z.read(info))[0])
        except zipfile.BadZipFile:
            if blob[8:12] == b".FIT":
                keys.append(store.add_fit(blob)[0])
        known[aid] = keys
        if n % 10 == 0:
            store.save_meta()
            print(f"  {n}/{len(todo)}")
        time.sleep(0.4)
    store.save_meta()


# ==========================================================================
# Verarbeitung
# ==========================================================================

def _process_one(args):
    path, zones = args
    try:
        res = fitproc.process(Path(path).read_bytes(), zones)
        return {"ok": [[s, d] for s, d in res]}
    except fitproc.NotAnActivity as e:
        return {"skip": str(e)}
    except Exception as e:                                       # defekte Datei: nicht abbrechen
        return {"error": f"{type(e).__name__}: {e}"}


def processed(cfg: Config, store: RawStore) -> list[tuple[dict, dict]]:
    tag = f"{fitproc.PROCESSOR_VERSION}-{cfg.privacy_hash}"
    results, todo = {}, []
    for key in store.keys():
        cp = store.cache / f"{key}.json.gz"
        if cp.exists():
            try:
                with gzip.open(cp, "rt", encoding="utf-8") as f:
                    c = json.load(f)
                if c.get("tag") == tag:
                    results[key] = c
                    continue
            except (OSError, json.JSONDecodeError):
                pass
        todo.append(key)
    if todo:
        print(f"Verarbeite {len(todo)} FIT-Datei(en) ...")
        workers = max(1, min(len(todo), (os.cpu_count() or 2) - 1))
        jobs = [(str(store.fit / f"{k}.fit"), cfg.zones) for k in todo]
        with cf.ProcessPoolExecutor(max_workers=workers) as ex:
            for i, (key, res) in enumerate(zip(todo, ex.map(_process_one, jobs, chunksize=4)), 1):
                res["tag"] = tag
                with gzip.open(store.cache / f"{key}.json.gz", "wt", encoding="utf-8") as f:
                    json.dump(res, f, separators=(",", ":"))
                results[key] = res
                if "error" in res:
                    print(f"  Fehler in {key}.fit: {res['error']}", file=sys.stderr)
                if i % 50 == 0:
                    print(f"  {i}/{len(todo)}")
    out = []
    for key, c in results.items():
        for s, d in c.get("ok", []):
            s["src"] = key
            out.append((s, d))
    return out


SPORT_NAMES = {"run": "Lauf", "ride": "Radfahrt", "swim": "Schwimmen", "strength": "Krafttraining"}
OTHER_NAMES = {"walking": "Spaziergang", "hiking": "Wanderung", "rowing": "Rudern",
               "cross_country_skiing": "Langlauf", "alpine_skiing": "Skifahren",
               "yoga": "Yoga", "tennis": "Tennis", "climbing": "Klettern",
               "fitness_equipment": "Training", "stand_up_paddleboarding": "SUP",
               "sailing": "Segeln", "surfing": "Surfen", "kayaking": "Kajak"}


def default_name(s: dict) -> str:
    h = int(s["start"][11:13])
    part = ("Nacht" if h < 5 else "Morgen" if h < 11 else "Mittag" if h < 14
            else "Nachmittag" if h < 18 else "Abend" if h < 22 else "Nacht")
    base = SPORT_NAMES.get(s["cat"]) or OTHER_NAMES.get(s.get("sub") or "") \
        or OTHER_NAMES.get(s.get("sport") or "") or "Aktivitaet"
    if s["cat"] == "swim" and s.get("sub") == "open_water":
        base = "Freiwasserschwimmen"
    if s["cat"] in ("run", "ride"):
        return f"{part}{base.lower()}" if part != "Mittag" else f"Mittags{base.lower()}"
    return f"{base} am {part}" if part != "Nacht" else f"{base} in der Nacht"


def assemble(cfg: Config, store: RawStore):
    items = processed(cfg, store)
    items.sort(key=lambda x: (x[0]["ts"], x[0]["src"]))
    seen, out = {}, []
    for s, d in items:
        k = (s["ts"], s["cat"])
        if k in seen:                                             # dieselbe Aktivitaet doppelt
            continue
        seen[k] = True
        if s["id"] in cfg.exclude:
            continue
        base, n = s["id"], 2
        while any(x[0]["id"] == s["id"] for x in out[-5:]):
            s["id"] = f"{base}-{n}"
            n += 1
        d["id"] = s["id"]
        name = None
        for off in (0, -1, 1, -2, 2, -60, 60):
            name = store.names.get(str(s["ts"] + off))
            if name:
                break
        if not name:                                              # Toleranz fuer Rundung
            for t, nm in store.names.items():
                if abs(int(t) - s["ts"]) <= 90:
                    name = nm
                    break
        s["name"] = name or default_name(s)
        out.append((s, d))
    return out


# ==========================================================================
# Ausgabe (optional verschluesselt)
# ==========================================================================

def derive_keys(passphrase: str, salt: bytes, iterations: int):
    raw = hashlib.pbkdf2_hmac("sha256", unicodedata.normalize("NFC", passphrase).encode("utf-8"),
                              salt, iterations, dklen=64)
    return raw[:32], raw[32:]


def pack(obj, name: str, key: bytes | None) -> tuple[bytes, str]:
    js = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    gz = gzip.compress(js, compresslevel=9, mtime=0)
    digest = hashlib.sha256(gz).hexdigest()
    if key is None:
        return MAGIC_PLAIN + gz, digest
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    aad = MAGIC_ENC + b"|" + name.encode("ascii")
    return MAGIC_ENC + nonce + AESGCM(key).encrypt(nonce, gz, aad), digest


def unpack(blob: bytes, name: str, key: bytes | None):
    if blob[:4] == MAGIC_PLAIN:
        gz = blob[4:]
    elif blob[:4] == MAGIC_ENC:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        gz = AESGCM(key).decrypt(blob[4:16], blob[16:], MAGIC_ENC + b"|" + name.encode("ascii"))
    else:
        raise ValueError("unbekanntes Format")
    return json.loads(gzip.decompress(gz))


def _in_public_repo(path: Path) -> bool:
    try:
        url = subprocess.run(["git", "-C", str(path), "remote", "get-url", "origin"],
                             capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return "github.com" in url or "gitlab.com" in url


def get_passphrase(existing: bool) -> str:
    pw = os.environ.get("TRAINING_PASSPHRASE")
    if pw:
        return pw
    if not sys.stdin.isatty():
        raise SystemExit("Passphrase noetig: TRAINING_PASSPHRASE setzen oder interaktiv starten.")
    pw = getpass.getpass("Passphrase fuer die Trainingsdaten: ")
    if not existing:
        if len(pw) < 16:
            print("Warnung: kurze Passphrase. Empfehlung: 5 zufaellige Woerter (Diceware).")
        if getpass.getpass("Passphrase wiederholen: ") != pw:
            raise SystemExit("Passphrasen stimmen nicht ueberein.")
    return pw


def cmd_build(cfg: Config, allow_public_plain=False):
    store = RawStore(cfg.raw)
    out = cfg.out
    (out / "a").mkdir(parents=True, exist_ok=True)
    man_path = out / "manifest.json"
    manifest = _load_json(man_path, None)

    key = name_key = None
    if cfg.mode == "encrypted":
        if manifest and manifest.get("mode") == "encrypted":
            salt = base64.b64decode(manifest["kdf"]["salt"])
            iterations = int(manifest["kdf"]["iterations"])
            existing = (out / "index.bin").exists()
        else:
            salt, iterations, existing = os.urandom(16), KDF_ITERATIONS, False
        pw = get_passphrase(existing)
        key, name_key = derive_keys(pw, salt, iterations)
        if existing:
            try:
                unpack((out / "index.bin").read_bytes(), "index", key)
            except Exception:
                raise SystemExit("Falsche Passphrase: der vorhandene Index laesst sich damit nicht "
                                 "entschluesseln. Abbruch, nichts geschrieben.")
        kdf = {"alg": "PBKDF2-SHA256", "iterations": iterations,
               "salt": base64.b64encode(salt).decode()}
    else:
        if _in_public_repo(out) and not allow_public_plain:
            raise SystemExit("Modus 'plain' in einem Repo mit GitHub/GitLab-Remote: die Daten "
                             "waeren oeffentlich. Abbruch (Override: --allow-public-plain).")
        kdf = None

    items = assemble(cfg, store)
    state_path = cfg.raw / f"out-state-{cfg.mode}.json"
    state = _load_json(state_path, {})
    if state.get("_out") != str(out) or state.get("_kdf") != (kdf or {}).get("salt"):
        state = {}
    state["_out"], state["_kdf"] = str(out), (kdf or {}).get("salt")

    def fname(aid: str) -> str:
        if name_key is None:
            return aid
        return hmac.new(name_key, aid.encode(), hashlib.sha256).hexdigest()[:24]

    written = 0
    wanted = set()
    summaries = []
    for s, d in items:
        fn = fname(s["id"])
        wanted.add(fn)
        path = out / "a" / f"{fn}.bin"
        blob, digest = pack(d, fn, key)
        if state.get(fn) != digest or not path.exists():
            path.write_bytes(blob)
            state[fn] = digest
            written += 1
        s = {k: v for k, v in s.items() if k != "src" and v is not None}
        s["file"] = fn
        summaries.append(s)

    removed = 0
    for p in (out / "a").glob("*.bin"):
        if p.stem not in wanted:
            p.unlink()
            state.pop(p.stem, None)
            removed += 1

    index = {
        "v": FORMAT_VERSION,
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "athlete": {"thresholds": sorted(cfg.thresholds, key=lambda t: t["from"])},
        "activities": summaries,
    }
    blob, _ = pack(index, "index", key)
    (out / "index.bin").write_bytes(blob)
    new_manifest = {"format": FORMAT, "version": FORMAT_VERSION, "mode": cfg.mode}
    if kdf:
        new_manifest["kdf"] = kdf
    _dump_json(man_path, new_manifest)
    _dump_json(state_path, state)
    print(f"Ausgabe: {len(summaries)} Aktivitaeten, {written} Datei(en) geschrieben, "
          f"{removed} entfernt -> {out}")


def cmd_status(cfg: Config):
    store = RawStore(cfg.raw)
    keys = store.keys()
    cached = sum(1 for k in keys if (store.cache / f"{k}.json.gz").exists())
    print(f"Rohdaten:  {cfg.raw}\n  FIT-Dateien {len(keys)}, davon verarbeitet {cached}, "
          f"Namen {len(store.names)}, Garmin-IDs {len(store.garmin['ids'])}")
    man = _load_json(cfg.out / "manifest.json", None)
    print(f"Ausgabe:   {cfg.out}\n  Modus {man.get('mode') if man else '-'}, "
          f"Dateien {len(list((cfg.out / 'a').glob('*.bin'))) if (cfg.out / 'a').exists() else 0}")


def git_push(cfg: Config):
    root = subprocess.run(["git", "-C", str(cfg.out), "rev-parse", "--show-toplevel"],
                          capture_output=True, text=True).stdout.strip()
    if not root:
        raise SystemExit("out_dir liegt in keinem git-Repo.")
    rel = os.path.relpath(cfg.out, root)
    subprocess.run(["git", "-C", root, "add", "-A", "--", rel], check=True)
    if subprocess.run(["git", "-C", root, "diff", "--cached", "--quiet", "--", rel]).returncode == 0:
        print("git: keine Aenderungen.")
        return
    subprocess.run(["git", "-C", root, "commit", "-m", "Trainingsdaten aktualisieren", "--", rel], check=True)
    subprocess.run(["git", "-C", root, "push"], check=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(HERE / "config.json"))
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("garmin")
    g.add_argument("--full", action="store_true")
    g.add_argument("--since")
    g.add_argument("--push", action="store_true")
    i = sub.add_parser("import")
    i.add_argument("paths", nargs="+")
    i.add_argument("--push", action="store_true")
    b = sub.add_parser("build")
    b.add_argument("--push", action="store_true")
    b.add_argument("--allow-public-plain", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    cfg = Config(Path(a.config))
    if a.cmd == "status":
        return cmd_status(cfg)
    if a.cmd == "garmin":
        cmd_garmin(cfg, a.full, a.since)
    elif a.cmd == "import":
        cmd_import(cfg, a.paths)
    cmd_build(cfg, getattr(a, "allow_public_plain", False))
    if a.push:
        git_push(cfg)


if __name__ == "__main__":
    main()
