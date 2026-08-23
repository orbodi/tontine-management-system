from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_employe
from ..repository import employe_public, get_employe_by_identifiant
from ..security import create_access_token, verify_password
from .. import models as m

router = APIRouter(prefix="/auth", tags=["auth"])


def _uid() -> str:
    import random
    import time

    return f"{random.randrange(1_000_000):x}{int(time.time() * 1000):x}"[-16:]


class LoginRequest(BaseModel):
    identifiant: str
    motDePasse: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    employe: dict[str, Any]


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    emp = get_employe_by_identifiant(db, body.identifiant)
    if not emp or not emp.actif or not verify_password(body.motDePasse, emp.mot_de_passe_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiant ou mot de passe incorrect.")

    now = datetime.now(timezone.utc).isoformat()
    db.add(
        m.JournalConnexion(
            id=_uid(),
            employe_id=emp.id,
            employe_nom=emp.nom_complet,
            agence_id=emp.agence_id,
            date=now,
            type="connexion",
        )
    )
    db.commit()

    token = create_access_token(emp.id, {"role": emp.role})
    return TokenResponse(access_token=token, employe=employe_public(emp))


@router.post("/logout")
def logout(
    user: Annotated[dict[str, Any], Depends(current_employe)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, bool]:
    now = datetime.now(timezone.utc).isoformat()
    db.add(
        m.JournalConnexion(
            id=_uid(),
            employe_id=user["id"],
            employe_nom=user["nomComplet"],
            agence_id=user["agenceId"],
            date=now,
            type="deconnexion",
        )
    )
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: Annotated[dict[str, Any], Depends(current_employe)]) -> dict[str, Any]:
    return user
