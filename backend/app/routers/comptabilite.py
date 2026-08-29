"""API Comptabilité générale."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import comptabilite as C
from .. import models as m
from ..db import get_db
from ..deps import a_le_droit, current_employe

router = APIRouter(prefix="/comptabilite", tags=["comptabilite"])


def require_compta(user: Annotated[dict[str, Any], Depends(current_employe)]) -> dict[str, Any]:
    if user.get("role") == "admin" or a_le_droit(user, "gerer_comptabilite") or a_le_droit(user, "voir_rapports"):
        return user
    raise HTTPException(status_code=403, detail="Droit comptabilité insuffisant.")


def require_compta_ecriture(user: Annotated[dict[str, Any], Depends(current_employe)]) -> dict[str, Any]:
    if user.get("role") == "admin" or a_le_droit(user, "gerer_comptabilite"):
        return user
    raise HTTPException(status_code=403, detail="Réservé à la gestion comptable.")


@router.get("/overview")
def overview(
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    C.ensure_comptabilite_seed(db)
    exercices = [C.serialize_exercice(e) for e in db.query(m.ExerciceComptable).order_by(m.ExerciceComptable.annee.desc()).all()]
    ouvert = C.exercice_ouvert(db)
    return {
        "exercices": exercices,
        "exerciceOuvert": C.serialize_exercice(ouvert) if ouvert else None,
        "nbComptes": db.query(m.CompteComptable).count(),
        "nbJournaux": db.query(m.JournalComptable).count(),
    }


@router.get("/plan")
def plan_comptable(
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
    q: str | None = None,
    classe: int | None = None,
    actifs_seulement: bool = False,
) -> list[dict[str, Any]]:
    C.ensure_comptabilite_seed(db)
    query = db.query(m.CompteComptable)
    if actifs_seulement:
        query = query.filter_by(actif=True)
    if classe is not None:
        query = query.filter_by(classe=classe)
    rows = query.order_by(m.CompteComptable.numero).all()
    out = [C.serialize_compte(c) for c in rows]
    if q:
        ql = q.lower()
        out = [c for c in out if ql in c["numero"].lower() or ql in c["intitule"].lower()]
    return out


@router.post("/plan/{compte_id}/basculer-actif")
def basculer_compte(
    compte_id: str,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    err = C.basculer_actif_compte(db, compte_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    c = db.query(m.CompteComptable).filter_by(id=compte_id).first()
    return {"ok": True, "compte": C.serialize_compte(c) if c else None}


@router.get("/journaux")
def list_journaux(
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict[str, Any]]:
    C.ensure_comptabilite_seed(db)
    return [C.serialize_journal(j) for j in db.query(m.JournalComptable).order_by(m.JournalComptable.code).all()]


class JournalIn(BaseModel):
    code: str
    libelle: str


@router.post("/journaux")
def creer_journal(
    body: JournalIn,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    C.ensure_comptabilite_seed(db)
    err, j = C.creer_journal(db, body.code, body.libelle)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "journal": C.serialize_journal(j) if j else None}


class OuvrirExerciceBody(BaseModel):
    annee: int


@router.post("/exercices")
def ouvrir_exercice(
    body: OuvrirExerciceBody,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    err, ex = C.ouvrir_exercice(db, body.annee)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "exercice": C.serialize_exercice(ex)}


class ClotureBody(BaseModel):
    genererAnouveaux: bool = True


@router.post("/exercices/{exercice_id}/cloturer")
def cloturer(
    exercice_id: str,
    body: ClotureBody,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    err = C.cloturer_exercice(db, exercice_id, user, generer_anouveaux=body.genererAnouveaux)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True}


@router.get("/bilan/{exercice_id}")
def get_bilan(
    exercice_id: str,
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    ex = db.query(m.ExerciceComptable).filter_by(id=exercice_id).first()
    if not ex:
        raise HTTPException(status_code=404, detail="Exercice introuvable.")
    lignes = C.list_bilan(db, exercice_id)
    total_actif = sum(l["montant"] for l in lignes if l["sens"] == "actif")
    total_passif = sum(l["montant"] for l in lignes if l["sens"] == "passif")
    ecr = (
        db.query(m.EcritureComptable)
        .filter_by(source_type="bilan_initial", source_id=exercice_id)
        .first()
    )
    return {
        "exercice": C.serialize_exercice(ex),
        "lignes": lignes,
        "totalActif": total_actif,
        "totalPassif": total_passif,
        "equilibre": abs(total_actif - total_passif) < 0.005 and total_actif > 0,
        "pieceOuverture": ecr.numero_piece if ecr else None,
    }


class BilanLigneIn(BaseModel):
    compteNumero: str
    sens: str
    montant: float


class BilanBody(BaseModel):
    lignes: list[BilanLigneIn] = Field(default_factory=list)


@router.put("/bilan/{exercice_id}")
def put_bilan(
    exercice_id: str,
    body: BilanBody,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    err = C.sauvegarder_bilan(db, exercice_id, [l.model_dump() for l in body.lignes])
    if err:
        raise HTTPException(status_code=400, detail=err)
    return get_bilan(exercice_id, user, db)


@router.post("/bilan/{exercice_id}/valider")
def valider_bilan(
    exercice_id: str,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    err = C.valider_bilan(db, exercice_id, user)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, **get_bilan(exercice_id, user, db)}


@router.get("/ecritures")
def list_ecritures(
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
    exercice_id: str | None = None,
    journal_code: str | None = None,
    date_debut: str | None = None,
    date_fin: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> list[dict[str, Any]]:
    C.ensure_comptabilite_seed(db)
    q = db.query(m.EcritureComptable)
    if exercice_id:
        q = q.filter_by(exercice_id=exercice_id)
    else:
        ouvert = C.exercice_ouvert(db)
        if ouvert:
            q = q.filter_by(exercice_id=ouvert.id)
    if journal_code:
        journal = C.journal_par_code(db, journal_code)
        if not journal:
            return []
        q = q.filter_by(journal_id=journal.id)
    if date_debut:
        q = q.filter(m.EcritureComptable.date >= date_debut)
    if date_fin:
        q = q.filter(m.EcritureComptable.date <= date_fin)
    rows = q.order_by(m.EcritureComptable.date.desc(), m.EcritureComptable.numero_piece.desc()).limit(limit).all()
    return [C.serialize_ecriture(db, e) for e in rows]


class LigneIn(BaseModel):
    compteNumero: str
    debit: float = 0
    credit: float = 0
    libelle: str | None = None


class EcritureIn(BaseModel):
    journalCode: str = "OD"
    date: str
    libelle: str
    lignes: list[LigneIn]
    exerciceId: str | None = None


@router.post("/ecritures")
def creer_ecriture(
    body: EcritureIn,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    C.ensure_comptabilite_seed(db)
    ex_id = body.exerciceId
    if not ex_id:
        ouvert = C.exercice_ouvert(db)
        if not ouvert:
            raise HTTPException(status_code=400, detail="Aucun exercice ouvert.")
        ex_id = ouvert.id
    err, ecr = C.creer_ecriture(
        db,
        exercice_id=ex_id,
        journal_code=body.journalCode,
        date=body.date,
        libelle=body.libelle,
        lignes=[l.model_dump() for l in body.lignes],
        source="manuel",
        auteur_id=user.get("id"),
        auteur_nom=user.get("nomComplet"),
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "ecriture": C.serialize_ecriture(db, ecr) if ecr else None}


@router.delete("/ecritures/{ecriture_id}")
def supprimer_ecriture(
    ecriture_id: str,
    user: Annotated[dict[str, Any], Depends(require_compta_ecriture)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    err = C.supprimer_ecriture(db, ecriture_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True}


@router.get("/grand-livre")
def grand_livre(
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
    exercice_id: str | None = None,
    compte_numero: str | None = None,
    date_debut: str | None = None,
    date_fin: str | None = None,
) -> list[dict[str, Any]]:
    C.ensure_comptabilite_seed(db)
    if not exercice_id:
        ouvert = C.exercice_ouvert(db)
        if not ouvert:
            return []
        exercice_id = ouvert.id
    return C.grand_livre(
        db,
        exercice_id=exercice_id,
        compte_numero=compte_numero,
        date_debut=date_debut,
        date_fin=date_fin,
    )


@router.get("/balance")
def balance(
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
    exercice_id: str | None = None,
    date_debut: str | None = None,
    date_fin: str | None = None,
) -> list[dict[str, Any]]:
    C.ensure_comptabilite_seed(db)
    if not exercice_id:
        ouvert = C.exercice_ouvert(db)
        if not ouvert:
            return []
        exercice_id = ouvert.id
    return C.balance_generale(
        db, exercice_id=exercice_id, date_debut=date_debut, date_fin=date_fin
    )


@router.get("/balance.csv")
def balance_csv(
    user: Annotated[dict[str, Any], Depends(require_compta)],
    db: Annotated[Session, Depends(get_db)],
    exercice_id: str | None = None,
) -> Response:
    rows = balance(user, db, exercice_id=exercice_id)
    content = C.export_balance_csv(rows)
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="balance-generale.csv"'},
    )
