"""Seed SQLite : données démo et/ou comptes par défaut (.env)."""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .config import settings
from .repository import replace_state


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _uid(prefix: str = "") -> str:
    return f"{prefix}{secrets.token_hex(8)}"


def _apply_env_credentials(data: dict) -> dict:
    """Applique identifiants / mots de passe .env aux 3 comptes démo connus."""
    by_legacy_id = {
        "admin": (settings.admin_identifiant, settings.admin_password, settings.admin_nom),
        "chef": (settings.chef_identifiant, settings.chef_password, settings.chef_nom),
        "caisse": (settings.caisse_identifiant, settings.caisse_password, settings.caisse_nom),
    }
    for emp in data.get("employes", []):
        creds = by_legacy_id.get(emp.get("identifiant"))
        if not creds:
            continue
        new_id, new_pwd, new_nom = creds
        emp["identifiant"] = new_id
        emp["motDePasse"] = new_pwd
        emp["nomComplet"] = new_nom
    return data


def seed_database(db: Session) -> dict:
    path = settings.demo_seed_path
    if not path.exists():
        raise FileNotFoundError(f"Fichier seed introuvable: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    data = _apply_env_credentials(data)
    replace_state(db, data, hash_plain_passwords=True)
    return {
        "ok": True,
        "mode": "demo",
        "employes": len(data.get("employes", [])),
        "clients": len(data.get("clients", [])),
        "transactions": len(data.get("transactions", [])),
    }


def _empty_app_data() -> dict:
    return {
        "agences": [],
        "zones": [],
        "comptesZoneTontine": [],
        "journeesCompteZone": [],
        "ajustementsCompteZone": [],
        "employes": [],
        "clients": [],
        "carnets": [],
        "mises": [],
        "comptes": [],
        "demandesOuvertureCompte": [],
        "mouvementsComptes": [],
        "credits": [],
        "remboursements": [],
        "transactions": [],
        "ouverturesCaisse": [],
        "arretsCaisse": [],
        "comptesCaisse": [],
        "mouvementsCompteCaisse": [],
        "ajustementsCompteCaisse": [],
        "journalConnexions": [],
        "compteurs": {
            "client": 0,
            "carnet": 0,
            "compte": 0,
            "credit": 0,
            "compteCaisse": 0,
        },
        "compteursOrdreZone": {},
    }


def bootstrap_default_accounts(db: Session) -> dict:
    """Agence + admin / chef / caissier depuis .env (base vide uniquement)."""
    agence_id = _uid("ag")
    admin_id = _uid("em")
    chef_id = _uid("em")
    caisse_id = _uid("em")
    now = _now_iso()

    data = _empty_app_data()
    data["agences"] = [
        {
            "id": agence_id,
            "code": settings.default_agence_code,
            "nom": settings.default_agence_nom,
            "adresse": None,
            "telephone": None,
            "chefEmployeId": chef_id,
            "actif": True,
        }
    ]
    data["employes"] = [
        {
            "id": admin_id,
            "nomComplet": settings.admin_nom,
            "identifiant": settings.admin_identifiant,
            "motDePasse": settings.admin_password,
            "role": "admin",
            "agenceId": agence_id,
            "droits": [],
            "telephone": None,
            "email": None,
            "adresse": None,
            "pieceIdentite": None,
            "dateEmbauche": now,
            "actif": True,
        },
        {
            "id": chef_id,
            "nomComplet": settings.chef_nom,
            "identifiant": settings.chef_identifiant,
            "motDePasse": settings.chef_password,
            "role": "chef_agence",
            "agenceId": agence_id,
            "droits": [
                "gerer_clients",
                "operer_comptes",
                "approuver_credits",
                "verrouiller_comptes",
                "voir_rapports",
            ],
            "telephone": None,
            "email": None,
            "adresse": None,
            "pieceIdentite": None,
            "dateEmbauche": now,
            "actif": True,
        },
        {
            "id": caisse_id,
            "nomComplet": settings.caisse_nom,
            "identifiant": settings.caisse_identifiant,
            "motDePasse": settings.caisse_password,
            "role": "caissier",
            "agenceId": agence_id,
            "droits": ["gerer_clients", "operer_comptes"],
            "telephone": None,
            "email": None,
            "adresse": None,
            "pieceIdentite": None,
            "dateEmbauche": now,
            "actif": True,
        },
    ]
    data["comptesCaisse"] = [
        {
            "id": _uid("cc"),
            "employeId": caisse_id,
            "agenceId": agence_id,
            "numero": "CC-0001",
            "solde": 0,
            "cumulManquant": 0,
            "cumulSurplus": 0,
            "dateOuverture": now,
            "actif": True,
        },
    ]
    data["compteurs"]["compteCaisse"] = 1

    replace_state(db, data, hash_plain_passwords=True)
    return {
        "ok": True,
        "mode": "default_accounts",
        "employes": 3,
        "identifiants": [
            settings.admin_identifiant,
            settings.chef_identifiant,
            settings.caisse_identifiant,
        ],
    }


def ensure_startup_data(db: Session) -> dict | None:
    """Au démarrage : seed démo et/ou comptes par défaut selon .env."""
    from . import models as m

    has_any = db.query(m.Employe).first() is not None

    if settings.seed_demo_on_startup and not has_any:
        return seed_database(db)

    if settings.create_default_accounts and not has_any:
        return bootstrap_default_accounts(db)

    return None
