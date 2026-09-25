from __future__ import annotations

import math
import threading
import time
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
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


# Tentatives de connexion : au plus MAX_ECHECS_CONNEXION échecs par identifiant + adresse IP sur
# FENETRE_ECHECS_CONNEXION secondes. En mémoire (un seul processus) ; remise à zéro après une connexion réussie.
MAX_ECHECS_CONNEXION = 5
FENETRE_ECHECS_CONNEXION = 15 * 60
_echecs_connexion: dict[tuple[str, str], list[float]] = {}
_verrou_echecs_connexion = threading.Lock()


def _compter_tentative_connexion(cle: tuple[str, str]) -> None:
    """Refuse (429) si la limite d'échecs est atteinte, sinon compte la tentative comme un échec tant
    qu'elle n'a pas réussi (des tentatives simultanées ne peuvent pas dépasser la limite)."""
    maintenant = time.monotonic()
    with _verrou_echecs_connexion:
        echecs = [t for t in _echecs_connexion.get(cle, ()) if maintenant - t < FENETRE_ECHECS_CONNEXION]
        if len(echecs) >= MAX_ECHECS_CONNEXION:
            attente = FENETRE_ECHECS_CONNEXION - (maintenant - echecs[0])
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    "Trop de tentatives de connexion échouées. "
                    f"Réessayez dans {math.ceil(attente / 60)} minute(s)."
                ),
                headers={"Retry-After": str(math.ceil(attente))},
            )
        _echecs_connexion[cle] = echecs + [maintenant]
        if len(_echecs_connexion) > 10_000:  # identifiants au hasard : on oublie les clés expirées
            for k in [k for k, v in _echecs_connexion.items() if maintenant - v[-1] >= FENETRE_ECHECS_CONNEXION]:
                del _echecs_connexion[k]


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, db: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    cle_tentative = (body.identifiant.strip().lower(), request.client.host if request.client else "")
    _compter_tentative_connexion(cle_tentative)
    emp = get_employe_by_identifiant(db, body.identifiant)
    if not emp or not emp.actif or not verify_password(body.motDePasse, emp.mot_de_passe_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiant ou mot de passe incorrect.")
    with _verrou_echecs_connexion:
        _echecs_connexion.pop(cle_tentative, None)

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
