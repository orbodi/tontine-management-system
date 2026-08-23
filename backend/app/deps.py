from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .repository import employe_public, get_employe
from .security import decode_token

security = HTTPBearer(auto_error=False)

TOUS_DROITS = [
    "gerer_clients",
    "operer_comptes",
    "approuver_credits",
    "verrouiller_comptes",
    "gerer_employes",
    "voir_rapports",
    "gerer_agences",
    "gerer_zones",
    "gerer_comptabilite",
]


def current_employe(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Non authentifié.")
    payload = decode_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session invalide.")
    emp = get_employe(db, payload["sub"])
    if not emp or not emp.actif:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Employé inactif ou introuvable.")
    return employe_public(emp)


def require_admin(user: Annotated[dict[str, Any], Depends(current_employe)]) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Réservé à l'administrateur.")
    return user


def a_le_droit(user: dict[str, Any], droit: str) -> bool:
    if user.get("role") == "admin":
        return True
    return droit in (user.get("droits") or [])
