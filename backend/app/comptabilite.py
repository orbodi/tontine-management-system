"""Comptabilité générale SYSCOHADA : exercices, plan, écritures, états."""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import models as m
from .config import BASE_DIR, settings

PLAN_PATH = BASE_DIR / "data" / "plan-comptable-syscohada.json"

JOURNAUX_DEFAUT = [
    ("CAISSE", "Journal de caisse"),
    ("BANQUE", "Journal de banque"),
    ("ACHAT", "Journal des achats et charges"),
    ("OD", "Journal des opérations diverses"),
]

# type opération métier -> (journal, compte débit, compte crédit, libellé)
MAPPINGS_DEFAUT = [
    ("depot_compte", "CAISSE", "571", "4711", "Dépôt compte client"),
    ("depot_compte_epargne", "CAISSE", "571", "4712", "Dépôt épargne client"),
    ("retrait_compte", "CAISSE", "4711", "571", "Retrait compte client"),
    ("retrait_compte_epargne", "CAISSE", "4712", "571", "Retrait épargne client"),
    ("mise_tontine", "CAISSE", "571", "4721", "Cotisation tontine"),
    ("retrait_tontine", "CAISSE", "4721", "571", "Retrait cycle tontine"),
    ("commission_tontine", "CAISSE", "571", "7061", "Commission tontine"),
    ("vente_carnet", "CAISSE", "571", "7071", "Vente de carnet"),
    ("octroi_credit", "CAISSE", "4111", "571", "Octroi de crédit"),
    ("remboursement_credit", "CAISSE", "571", "4111", "Remboursement de crédit"),
    ("alimenter_caisse", "OD", "571", "521", "Alimentation de caisse depuis banque"),
    ("manquant_caisse", "OD", "6581", "571", "Manquant de caisse"),
    ("surplus_caisse", "OD", "571", "7581", "Surplus de caisse"),
]


def _uid(prefix: str = "cp") -> str:
    return f"{prefix}{secrets.token_hex(8)}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def ensure_comptabilite_seed(db: Session) -> None:
    """Seed plan, journaux, mappings et exercice courant si absents."""
    if db.query(m.CompteComptable).count() == 0:
        path = PLAN_PATH if PLAN_PATH.exists() else settings.demo_seed_path.parent / "plan-comptable-syscohada.json"
        comptes = json.loads(path.read_text(encoding="utf-8"))
        for c in comptes:
            db.add(
                m.CompteComptable(
                    id=_uid("cc"),
                    numero=c["numero"],
                    intitule=c["intitule"],
                    classe=int(c["classe"]),
                    type=c["type"],
                    actif=True,
                )
            )

    if db.query(m.JournalComptable).count() == 0:
        for code, libelle in JOURNAUX_DEFAUT:
            db.add(m.JournalComptable(id=_uid("jr"), code=code, libelle=libelle, actif=True))

    if db.query(m.MappingEcriture).count() == 0:
        for typ, jcode, deb, cred, lib in MAPPINGS_DEFAUT:
            db.add(
                m.MappingEcriture(
                    id=_uid("mp"),
                    type_operation=typ,
                    journal_code=jcode,
                    compte_debit=deb,
                    compte_credit=cred,
                    libelle_modele=lib,
                    actif=True,
                )
            )

    year = datetime.now(timezone.utc).year
    if db.query(m.ExerciceComptable).filter_by(annee=year).first() is None:
        db.add(
            m.ExerciceComptable(
                id=_uid("ex"),
                annee=year,
                date_debut=f"{year}-01-01",
                date_fin=f"{year}-12-31",
                statut="ouvert",
                bilan_valide=False,
                date_cloture=None,
            )
        )
    db.commit()


def exercice_ouvert(db: Session) -> m.ExerciceComptable | None:
    return (
        db.query(m.ExerciceComptable)
        .filter_by(statut="ouvert")
        .order_by(m.ExerciceComptable.annee.desc())
        .first()
    )


def compte_par_numero(db: Session, numero: str) -> m.CompteComptable | None:
    return db.query(m.CompteComptable).filter_by(numero=numero).first()


def journal_par_code(db: Session, code: str) -> m.JournalComptable | None:
    return db.query(m.JournalComptable).filter_by(code=code).first()


def _valider_lignes(lignes: list[dict[str, Any]]) -> str | None:
    if len(lignes) < 2:
        return "Une écriture doit comporter au moins deux lignes."
    total_d = sum(float(x.get("debit") or 0) for x in lignes)
    total_c = sum(float(x.get("credit") or 0) for x in lignes)
    if abs(total_d - total_c) > 0.005:
        return f"Écriture déséquilibrée (débit {total_d:.0f} ≠ crédit {total_c:.0f})."
    for lig in lignes:
        d, c = float(lig.get("debit") or 0), float(lig.get("credit") or 0)
        if d < 0 or c < 0:
            return "Montants négatifs interdits."
        if d > 0 and c > 0:
            return "Une ligne ne peut pas être à la fois débit et crédit."
        if d == 0 and c == 0:
            return "Ligne à zéro interdite."
    return None


def creer_ecriture(
    db: Session,
    *,
    exercice_id: str,
    journal_code: str,
    date: str,
    libelle: str,
    lignes: list[dict[str, Any]],
    source: str = "manuel",
    source_type: str | None = None,
    source_id: str | None = None,
    auteur_id: str | None = None,
    auteur_nom: str | None = None,
    numero_piece: str | None = None,
) -> tuple[str | None, m.EcritureComptable | None]:
    ex = db.query(m.ExerciceComptable).filter_by(id=exercice_id).first()
    if not ex:
        return "Exercice introuvable.", None
    if ex.statut != "ouvert":
        return "Exercice clôturé : écritures impossibles.", None
    journal = journal_par_code(db, journal_code)
    if not journal:
        return f"Journal {journal_code} introuvable.", None
    err = _valider_lignes(lignes)
    if err:
        return err, None

    if source_id:
        exist = (
            db.query(m.EcritureComptable)
            .filter_by(source_type=source_type, source_id=source_id)
            .first()
        )
        if exist:
            return None, exist

    piece = numero_piece or f"{journal.code}-{_today().replace('-', '')}-{secrets.token_hex(3).upper()}"
    eid = _uid("ec")
    ecriture = m.EcritureComptable(
        id=eid,
        exercice_id=exercice_id,
        journal_id=journal.id,
        date=date[:10] if date else _today(),
        numero_piece=piece,
        libelle=libelle,
        source=source,
        source_type=source_type,
        source_id=source_id,
        auteur_id=auteur_id,
        auteur_nom=auteur_nom,
        date_creation=_now_iso(),
    )
    db.add(ecriture)

    for lig in lignes:
        num = str(lig.get("compteNumero") or lig.get("compte_numero") or "")
        compte = compte_par_numero(db, num)
        if not compte:
            db.rollback()
            return f"Compte {num} introuvable.", None
        db.add(
            m.LigneEcriture(
                id=_uid("le"),
                ecriture_id=eid,
                compte_id=compte.id,
                compte_numero=compte.numero,
                libelle=lig.get("libelle"),
                debit=float(lig.get("debit") or 0),
                credit=float(lig.get("credit") or 0),
            )
        )
    db.commit()
    db.refresh(ecriture)
    return None, ecriture


def poster_transaction_auto(
    db: Session,
    tx: dict[str, Any],
    *,
    type_compte: str | None = None,
    auteur_id: str | None = None,
    auteur_nom: str | None = None,
) -> str | None:
    """Poste une écriture depuis une transaction métier (idempotent)."""
    ensure_comptabilite_seed(db)
    ex = exercice_ouvert(db)
    if not ex:
        return "Aucun exercice ouvert."

    typ = tx.get("type") or ""
    if typ == "depot_compte" and type_compte == "epargne":
        typ = "depot_compte_epargne"
    elif typ == "retrait_compte" and type_compte == "epargne":
        typ = "retrait_compte_epargne"

    mapping = db.query(m.MappingEcriture).filter_by(type_operation=typ, actif=True).first()
    if not mapping:
        return None  # pas de mapping = silencieux

    montant = float(tx.get("montant") or 0)
    if montant <= 0:
        return None

    err, _ = creer_ecriture(
        db,
        exercice_id=ex.id,
        journal_code=mapping.journal_code,
        date=(tx.get("date") or _today())[:10],
        libelle=f"{mapping.libelle_modele} — {tx.get('description') or ''}".strip(" —"),
        lignes=[
            {"compteNumero": mapping.compte_debit, "debit": montant, "credit": 0},
            {"compteNumero": mapping.compte_credit, "debit": 0, "credit": montant},
        ],
        source="auto",
        source_type="transaction",
        source_id=tx.get("id"),
        auteur_id=auteur_id or tx.get("operateurId"),
        auteur_nom=auteur_nom or tx.get("operateur"),
    )
    return err


def sync_auto_from_state(db: Session, data: dict[str, Any], user: dict[str, Any] | None = None) -> None:
    """Poste les transactions / mouvements caisse non encore comptabilisés."""
    ensure_comptabilite_seed(db)
    comptes_by_id = {c["id"]: c for c in data.get("comptes", [])}
    for tx in data.get("transactions", []):
        exist = (
            db.query(m.EcritureComptable)
            .filter_by(source_type="transaction", source_id=tx["id"])
            .first()
        )
        if exist:
            continue
        type_compte = None
        # Heuristique : si description mentionne épargne ou client a un compte épargne lié
        desc = (tx.get("description") or "").lower()
        if "épargne" in desc or "epargne" in desc:
            type_compte = "epargne"
        poster_transaction_auto(
            db,
            tx,
            type_compte=type_compte,
            auteur_id=(user or {}).get("id") or tx.get("operateurId"),
            auteur_nom=(user or {}).get("nomComplet") or tx.get("operateur"),
        )

    # Écarts d'arrêt de caisse
    for arret in data.get("arretsCaisse", []):
        sid = arret["id"]
        exist = db.query(m.EcritureComptable).filter_by(source_type="arret_caisse", source_id=sid).first()
        if exist:
            continue
        ecart = float(arret.get("ecart") or 0)
        if abs(ecart) < 0.005:
            continue
        typ = "surplus_caisse" if ecart > 0 else "manquant_caisse"
        mapping = db.query(m.MappingEcriture).filter_by(type_operation=typ, actif=True).first()
        ex = exercice_ouvert(db)
        if not mapping or not ex:
            continue
        montant = abs(ecart)
        creer_ecriture(
            db,
            exercice_id=ex.id,
            journal_code=mapping.journal_code,
            date=(arret.get("journee") or arret.get("dateCloture") or _today())[:10],
            libelle=f"{mapping.libelle_modele} — {arret.get('employeNom', '')}",
            lignes=[
                {"compteNumero": mapping.compte_debit, "debit": montant, "credit": 0},
                {"compteNumero": mapping.compte_credit, "debit": 0, "credit": montant},
            ],
            source="auto",
            source_type="arret_caisse",
            source_id=sid,
            auteur_id=(user or {}).get("id"),
            auteur_nom=(user or {}).get("nomComplet"),
        )

    _ = comptes_by_id  # réservé extensions futures


# ---------- Sérialisation / API helpers ----------


def serialize_exercice(e: m.ExerciceComptable) -> dict[str, Any]:
    return {
        "id": e.id,
        "annee": e.annee,
        "dateDebut": e.date_debut,
        "dateFin": e.date_fin,
        "statut": e.statut,
        "bilanValide": e.bilan_valide,
        "dateCloture": e.date_cloture,
    }


def serialize_compte(c: m.CompteComptable) -> dict[str, Any]:
    return {
        "id": c.id,
        "numero": c.numero,
        "intitule": c.intitule,
        "classe": c.classe,
        "type": c.type,
        "actif": c.actif,
    }


def serialize_journal(j: m.JournalComptable) -> dict[str, Any]:
    return {"id": j.id, "code": j.code, "libelle": j.libelle, "actif": j.actif}


def serialize_ecriture(db: Session, e: m.EcritureComptable) -> dict[str, Any]:
    lignes = db.query(m.LigneEcriture).filter_by(ecriture_id=e.id).all()
    journal = db.query(m.JournalComptable).filter_by(id=e.journal_id).first()
    return {
        "id": e.id,
        "exerciceId": e.exercice_id,
        "journalId": e.journal_id,
        "journalCode": journal.code if journal else "",
        "date": e.date,
        "numeroPiece": e.numero_piece,
        "libelle": e.libelle,
        "source": e.source,
        "sourceType": e.source_type,
        "sourceId": e.source_id,
        "auteurId": e.auteur_id,
        "auteurNom": e.auteur_nom,
        "dateCreation": e.date_creation,
        "lignes": [
            {
                "id": lig.id,
                "compteId": lig.compte_id,
                "compteNumero": lig.compte_numero,
                "libelle": lig.libelle,
                "debit": lig.debit,
                "credit": lig.credit,
            }
            for lig in lignes
        ],
        "totalDebit": sum(lig.debit for lig in lignes),
        "totalCredit": sum(lig.credit for lig in lignes),
    }


def list_bilan(db: Session, exercice_id: str) -> list[dict[str, Any]]:
    rows = db.query(m.BilanInitialLigne).filter_by(exercice_id=exercice_id).all()
    return [
        {
            "id": r.id,
            "exerciceId": r.exercice_id,
            "compteId": r.compte_id,
            "compteNumero": r.compte_numero,
            "sens": r.sens,
            "montant": r.montant,
        }
        for r in rows
    ]


def sauvegarder_bilan(
    db: Session, exercice_id: str, lignes: list[dict[str, Any]]
) -> str | None:
    ex = db.query(m.ExerciceComptable).filter_by(id=exercice_id).first()
    if not ex:
        return "Exercice introuvable."
    if ex.bilan_valide:
        return "Bilan déjà validé."
    if ex.statut != "ouvert":
        return "Exercice clôturé."

    db.query(m.BilanInitialLigne).filter_by(exercice_id=exercice_id).delete()
    for lig in lignes:
        num = str(lig.get("compteNumero") or "")
        compte = compte_par_numero(db, num)
        if not compte:
            db.rollback()
            return f"Compte {num} introuvable."
        montant = float(lig.get("montant") or 0)
        if montant <= 0:
            continue
        sens = lig.get("sens") or ("actif" if compte.type == "actif" else "passif")
        db.add(
            m.BilanInitialLigne(
                id=_uid("bi"),
                exercice_id=exercice_id,
                compte_id=compte.id,
                compte_numero=compte.numero,
                sens=sens,
                montant=montant,
            )
        )
    db.commit()
    return None


def valider_bilan(db: Session, exercice_id: str, user: dict[str, Any]) -> str | None:
    ex = db.query(m.ExerciceComptable).filter_by(id=exercice_id).first()
    if not ex:
        return "Exercice introuvable."
    if ex.bilan_valide:
        return "Bilan déjà validé."
    rows = db.query(m.BilanInitialLigne).filter_by(exercice_id=exercice_id).all()
    total_actif = sum(r.montant for r in rows if r.sens == "actif")
    total_passif = sum(r.montant for r in rows if r.sens == "passif")
    if abs(total_actif - total_passif) > 0.005:
        return f"Bilan déséquilibré (actif {total_actif:.0f} ≠ passif {total_passif:.0f})."
    if total_actif <= 0:
        return "Bilan vide."

    # Contrepartie 891 pour équilibrer si besoin — ici chaque ligne a son pendant via actif=passif
    # Écriture d'ouverture : débits actifs, crédits passifs
    lignes_ecr: list[dict[str, Any]] = []
    for r in rows:
        if r.sens == "actif":
            lignes_ecr.append({"compteNumero": r.compte_numero, "debit": r.montant, "credit": 0})
        else:
            lignes_ecr.append({"compteNumero": r.compte_numero, "debit": 0, "credit": r.montant})

    err, _ = creer_ecriture(
        db,
        exercice_id=exercice_id,
        journal_code="OD",
        date=ex.date_debut,
        libelle=f"Bilan d'ouverture exercice {ex.annee}",
        lignes=lignes_ecr,
        source="ouverture",
        source_type="bilan_initial",
        source_id=exercice_id,
        auteur_id=user.get("id"),
        auteur_nom=user.get("nomComplet"),
        numero_piece=f"BO-{ex.annee}",
    )
    if err:
        return err
    ex.bilan_valide = True
    db.commit()
    return None


def grand_livre(
    db: Session,
    *,
    exercice_id: str,
    compte_numero: str | None = None,
    date_debut: str | None = None,
    date_fin: str | None = None,
) -> list[dict[str, Any]]:
    q = (
        db.query(m.LigneEcriture, m.EcritureComptable)
        .join(m.EcritureComptable, m.LigneEcriture.ecriture_id == m.EcritureComptable.id)
        .filter(m.EcritureComptable.exercice_id == exercice_id)
    )
    if compte_numero:
        q = q.filter(m.LigneEcriture.compte_numero == compte_numero)
    if date_debut:
        q = q.filter(m.EcritureComptable.date >= date_debut)
    if date_fin:
        q = q.filter(m.EcritureComptable.date <= date_fin)
    rows = q.order_by(m.EcritureComptable.date, m.EcritureComptable.numero_piece).all()

    by_compte: dict[str, list] = {}
    for lig, ecr in rows:
        by_compte.setdefault(lig.compte_numero, []).append((lig, ecr))

    result = []
    for numero, items in sorted(by_compte.items()):
        compte = compte_par_numero(db, numero)
        solde = 0.0
        mouvements = []
        for lig, ecr in items:
            solde += lig.debit - lig.credit
            mouvements.append(
                {
                    "date": ecr.date,
                    "numeroPiece": ecr.numero_piece,
                    "libelle": lig.libelle or ecr.libelle,
                    "debit": lig.debit,
                    "credit": lig.credit,
                    "solde": solde,
                    "ecritureId": ecr.id,
                }
            )
        result.append(
            {
                "compteNumero": numero,
                "intitule": compte.intitule if compte else "",
                "mouvements": mouvements,
                "soldeFinal": solde,
            }
        )
    return result


def balance_generale(
    db: Session,
    *,
    exercice_id: str,
    date_debut: str | None = None,
    date_fin: str | None = None,
) -> list[dict[str, Any]]:
    q = (
        db.query(m.LigneEcriture, m.EcritureComptable)
        .join(m.EcritureComptable, m.LigneEcriture.ecriture_id == m.EcritureComptable.id)
        .filter(m.EcritureComptable.exercice_id == exercice_id)
    )
    if date_debut:
        q = q.filter(m.EcritureComptable.date >= date_debut)
    if date_fin:
        q = q.filter(m.EcritureComptable.date <= date_fin)

    agg: dict[str, dict[str, float]] = {}
    for lig, _ecr in q.all():
        slot = agg.setdefault(lig.compte_numero, {"debit": 0.0, "credit": 0.0})
        slot["debit"] += lig.debit
        slot["credit"] += lig.credit

    out = []
    for numero in sorted(agg.keys()):
        compte = compte_par_numero(db, numero)
        d, c = agg[numero]["debit"], agg[numero]["credit"]
        solde_d = max(d - c, 0)
        solde_c = max(c - d, 0)
        out.append(
            {
                "compteNumero": numero,
                "intitule": compte.intitule if compte else "",
                "classe": compte.classe if compte else 0,
                "totalDebit": d,
                "totalCredit": c,
                "soldeDebiteur": solde_d,
                "soldeCrediteur": solde_c,
            }
        )
    return out


def ouvrir_exercice(db: Session, annee: int) -> tuple[str | None, m.ExerciceComptable | None]:
    ensure_comptabilite_seed(db)
    if db.query(m.ExerciceComptable).filter_by(annee=annee).first():
        return f"Exercice {annee} existe déjà.", None
    ouvert = exercice_ouvert(db)
    if ouvert:
        return f"Clôturez d'abord l'exercice {ouvert.annee}.", None
    ex = m.ExerciceComptable(
        id=_uid("ex"),
        annee=annee,
        date_debut=f"{annee}-01-01",
        date_fin=f"{annee}-12-31",
        statut="ouvert",
        bilan_valide=False,
        date_cloture=None,
    )
    db.add(ex)
    db.commit()
    db.refresh(ex)
    return None, ex


def cloturer_exercice(
    db: Session, exercice_id: str, user: dict[str, Any], *, generer_anouveaux: bool = True
) -> str | None:
    ex = db.query(m.ExerciceComptable).filter_by(id=exercice_id).first()
    if not ex:
        return "Exercice introuvable."
    if ex.statut != "ouvert":
        return "Exercice déjà clôturé."

    bal = balance_generale(db, exercice_id=exercice_id) if generer_anouveaux else []
    prochaine = ex.annee + 1

    ex.statut = "cloture"
    ex.date_cloture = _now_iso()
    db.commit()

    if not generer_anouveaux:
        return None

    suivant = db.query(m.ExerciceComptable).filter_by(annee=prochaine).first()
    if not suivant:
        err, suivant = ouvrir_exercice(db, prochaine)
        if err or not suivant:
            return err or "Impossible d'ouvrir l'exercice suivant."

    lignes_an: list[dict[str, Any]] = []
    for row in bal:
        sd, sc = row["soldeDebiteur"], row["soldeCrediteur"]
        # Ne reporter que bilans (classes 1-5), pas charges/produits
        compte = compte_par_numero(db, row["compteNumero"])
        if compte and compte.classe >= 6:
            continue
        if sd > 0.005:
            lignes_an.append({"compteNumero": row["compteNumero"], "debit": sd, "credit": 0})
        elif sc > 0.005:
            lignes_an.append({"compteNumero": row["compteNumero"], "debit": 0, "credit": sc})
    if len(lignes_an) >= 2:
        err, _ = creer_ecriture(
            db,
            exercice_id=suivant.id,
            journal_code="OD",
            date=suivant.date_debut,
            libelle=f"À-nouveaux depuis exercice {ex.annee}",
            lignes=lignes_an,
            source="anouveaux",
            source_type="cloture",
            source_id=ex.id,
            auteur_id=user.get("id"),
            auteur_nom=user.get("nomComplet"),
            numero_piece=f"AN-{prochaine}",
        )
        if err:
            return f"Clôturé mais à-nouveaux échoués : {err}"
    return None


def basculer_actif_compte(db: Session, compte_id: str) -> str | None:
    c = db.query(m.CompteComptable).filter_by(id=compte_id).first()
    if not c:
        return "Compte introuvable."
    c.actif = not c.actif
    db.commit()
    return None


def export_balance_csv(rows: list[dict[str, Any]]) -> str:
    lines = ["numero;intitule;classe;total_debit;total_credit;solde_debiteur;solde_crediteur"]
    for r in rows:
        lines.append(
            f"{r['compteNumero']};{r['intitule']};{r['classe']};"
            f"{r['totalDebit']:.0f};{r['totalCredit']:.0f};"
            f"{r['soldeDebiteur']:.0f};{r['soldeCrediteur']:.0f}"
        )
    return "\n".join(lines) + "\n"
