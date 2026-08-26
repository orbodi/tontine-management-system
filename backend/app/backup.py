"""Export / import de sauvegarde AppData en CSV (ZIP multi-fichiers)."""
from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from .repository import load_state, replace_state

# Ordre d'export / tables listes
LIST_KEYS = [
    "agences",
    "zones",
    "comptesZoneTontine",
    "journeesCompteZone",
    "ajustementsCompteZone",
    "employes",
    "clients",
    "carnets",
    "mises",
    "comptes",
    "demandesOuvertureCompte",
    "mouvements",
    "credits",
    "remboursements",
    "transactions",
    "comptesCaisse",
    "mouvementsCompteCaisse",
    "ajustementsCompteCaisse",
    "ouverturesCaisse",
    "arretsCaisse",
    "journalConnexions",
]


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _parse_cell(raw: str, sample: Any = None) -> Any:
    if raw == "":
        return None if sample is None else sample
    s = raw
    if sample is True or sample is False:
        return s in ("1", "true", "True", "oui", "Oui")
    if isinstance(sample, int) and not isinstance(sample, bool):
        try:
            return int(float(s.replace(",", ".")))
        except ValueError:
            return sample
    if isinstance(sample, float):
        try:
            return float(s.replace(",", "."))
        except ValueError:
            return sample
    if isinstance(sample, (list, dict)) or (s.startswith("[") or s.startswith("{")):
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return s
    return s


def _rows_to_csv(rows: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    if not rows:
        buf.write("")
        return buf.getvalue()
    # Union des clés pour stabilité
    keys: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for k in row:
            if k not in seen:
                seen.add(k)
                keys.append(k)
    writer = csv.DictWriter(buf, fieldnames=keys, delimiter=";", extrasaction="ignore", lineterminator="\r\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: _cell(row.get(k)) for k in keys})
    return buf.getvalue()


def _csv_to_rows(text: str) -> list[dict[str, Any]]:
    text = text.lstrip("\ufeff").strip()
    if not text:
        return []
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    return [dict(r) for r in reader]


def build_export_state(db: Session) -> dict[str, Any]:
    data = load_state(db, include_password_hashes=True)
    for e in data.get("employes", []):
        # Restauration : hash dans motDePasse pour replace_state
        h = e.pop("_passwordHash", None)
        if h:
            e["motDePasse"] = h
        else:
            e["motDePasse"] = e.get("motDePasse") or ""
    return data


def export_zip_bytes(db: Session) -> tuple[bytes, str]:
    data = build_export_state(db)
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for key in LIST_KEYS:
            rows = data.get(key) or []
            if not isinstance(rows, list):
                continue
            zf.writestr(f"{key}.csv", "\ufeff" + _rows_to_csv(rows))
        # Compteurs
        compteurs = data.get("compteurs") or {}
        zf.writestr(
            "compteurs.csv",
            "\ufeff"
            + _rows_to_csv([{"cle": k, "valeur": v} for k, v in compteurs.items()]),
        )
        ordre = data.get("compteursOrdreZone") or {}
        zf.writestr(
            "compteursOrdreZone.csv",
            "\ufeff"
            + _rows_to_csv([{"zoneId": k, "valeur": v} for k, v in ordre.items()]),
        )
        zf.writestr(
            "manifest.json",
            json.dumps(
                {"format": "don-de-dieu-csv-v1", "tables": LIST_KEYS + ["compteurs", "compteursOrdreZone"]},
                ensure_ascii=False,
                indent=2,
            ),
        )
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return mem.getvalue(), f"sauvegarde-don-de-dieu-{stamp}.zip"


def _coerce_row(row: dict[str, str], template: dict[str, Any] | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if k is None:
            continue
        sample = template.get(k) if template else None
        parsed = _parse_cell(v if v is not None else "", sample)
        # Booléens connus
        if k in (
            "actif",
            "verrouille",
            "retraitActiveParAdmin",
            "cloturee",
        ) and parsed is not None and not isinstance(parsed, bool):
            parsed = str(parsed) in ("1", "true", "True", "oui")
        # Nombres connus
        if k in (
            "solde",
            "montant",
            "mise",
            "cumulManquant",
            "cumulSurplus",
            "montantReel",
            "montantTheorique",
            "ecart",
            "totalEntrees",
            "totalSorties",
            "soldeOuverture",
            "soldeTheorique",
            "montantCompte",
            "tauxInteret",
            "cumulAvant",
            "cumulApres",
            "soldeApres",
        ) and parsed is not None and not isinstance(parsed, (int, float)):
            try:
                parsed = float(str(parsed).replace(",", "."))
            except ValueError:
                pass
        if k in (
            "ordreZone",
            "cycle",
            "cycleActuel",
            "misesParCycle",
            "nombreMises",
            "nombreOperations",
            "dureeMois",
        ) and parsed is not None:
            try:
                parsed = int(float(str(parsed).replace(",", ".")))
            except ValueError:
                pass
        out[k] = parsed
    return out


def import_zip_bytes(db: Session, raw: bytes) -> dict[str, Any]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise ValueError("Fichier ZIP invalide. Exportez d'abord une sauvegarde depuis l'application.") from exc

    names = set(zf.namelist())
    current = load_state(db, include_password_hashes=True)
    data: dict[str, Any] = {k: [] for k in LIST_KEYS}
    data["compteurs"] = {"client": 0, "compte": 0, "credit": 0, "compteCaisse": 0}
    data["compteursOrdreZone"] = {}

    for key in LIST_KEYS:
        fname = f"{key}.csv"
        if fname not in names:
            continue
        text = zf.read(fname).decode("utf-8-sig")
        rows_raw = _csv_to_rows(text)
        template = current.get(key, [{}])[0] if current.get(key) else None
        data[key] = [_coerce_row(r, template) for r in rows_raw]
        # Employés : motDePasse = hash bcrypt si présent
        if key == "employes":
            for e in data[key]:
                if not e.get("motDePasse"):
                    e["motDePasse"] = "changeme"
                if e.get("droits") is None:
                    e["droits"] = []

    if "compteurs.csv" in names:
        for r in _csv_to_rows(zf.read("compteurs.csv").decode("utf-8-sig")):
            cle = r.get("cle")
            if not cle:
                continue
            try:
                data["compteurs"][cle] = int(float(r.get("valeur") or 0))
            except ValueError:
                data["compteurs"][cle] = 0

    if "compteursOrdreZone.csv" in names:
        for r in _csv_to_rows(zf.read("compteursOrdreZone.csv").decode("utf-8-sig")):
            zid = r.get("zoneId")
            if not zid:
                continue
            try:
                data["compteursOrdreZone"][zid] = int(float(r.get("valeur") or 0))
            except ValueError:
                data["compteursOrdreZone"][zid] = 0

    if not data.get("employes"):
        raise ValueError("Sauvegarde incomplete : aucun employe.")

    replace_state(db, data, hash_plain_passwords=True)
    from .migrations import repair_data_after_replace

    repair_data_after_replace(db)
    return load_state(db, include_password_hashes=False)
