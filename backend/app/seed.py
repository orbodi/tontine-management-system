"""Seed SQLite depuis backend/data/demo-seed.json."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .config import settings
from .repository import replace_state


def seed_database(db: Session) -> dict:
    path = settings.demo_seed_path
    if not path.exists():
        raise FileNotFoundError(f"Fichier seed introuvable: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    replace_state(db, data, hash_plain_passwords=True)
    return {
        "ok": True,
        "employes": len(data.get("employes", [])),
        "clients": len(data.get("clients", [])),
        "transactions": len(data.get("transactions", [])),
    }
