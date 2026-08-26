"""Persistance AppData : tables relationnelles + import/export camelCase."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from . import models as m
from .security import hash_password


def _clear_all(db: Session) -> None:
    for table in (
        m.JournalConnexion,
        m.ArretCaisse,
        m.OuvertureCaisse,
        m.AjustementCompteCaisse,
        m.MouvementCompteCaisse,
        m.CompteCaisse,
        m.Transaction,
        m.Remboursement,
        m.Credit,
        m.MouvementCompte,
        m.Compte,
        m.DemandeOuvertureCompte,
        m.Mise,
        m.Carnet,
        m.Client,
        m.AjustementCompteZone,
        m.JourneeCompteZone,
        m.CompteZoneTontine,
        m.Zone,
        m.Employe,
        m.Agence,
        m.Compteur,
        m.CompteurOrdreZone,
    ):
        db.query(table).delete()


def replace_state(db: Session, data: dict[str, Any], *, hash_plain_passwords: bool = True) -> None:
    """Remplace tout l'état. Si motDePasse n'est pas un hash bcrypt, le hasher."""
    _clear_all(db)

    for a in data.get("agences", []):
        db.add(
            m.Agence(
                id=a["id"],
                code=a["code"],
                nom=a["nom"],
                adresse=a.get("adresse"),
                telephone=a.get("telephone"),
                chef_employe_id=a.get("chefEmployeId"),
                actif=a.get("actif", True),
            )
        )

    for z in data.get("zones", []):
        db.add(
            m.Zone(
                id=z["id"],
                agence_id=z["agenceId"],
                code=z["code"],
                nom=z.get("nom"),
                actif=z.get("actif", True),
            )
        )

    for c in data.get("comptesZoneTontine", []):
        db.add(
            m.CompteZoneTontine(
                id=c["id"],
                zone_id=c["zoneId"],
                cumul_manquant=c.get("cumulManquant", 0),
                cumul_surplus=c.get("cumulSurplus", 0),
                actif=c.get("actif", True),
            )
        )

    for j in data.get("journeesCompteZone", []):
        db.add(
            m.JourneeCompteZone(
                id=j["id"],
                compte_zone_id=j["compteZoneId"],
                zone_id=j["zoneId"],
                date=j["date"],
                montant_reel=j.get("montantReel", 0),
                montant_theorique=j.get("montantTheorique", 0),
                ecart=j.get("ecart", 0),
                statut=j.get("statut", "en_cours"),
                cloturee=j.get("cloturee", False),
                date_saisie_reel=j["dateSaisieReel"],
                date_cloture=j.get("dateCloture"),
                operateur_id=j["operateurId"],
                operateur_nom=j["operateurNom"],
                note=j.get("note"),
            )
        )

    for a in data.get("ajustementsCompteZone", []):
        db.add(
            m.AjustementCompteZone(
                id=a["id"],
                compte_zone_id=a["compteZoneId"],
                zone_id=a["zoneId"],
                date=a["date"],
                type=a["type"],
                montant=a["montant"],
                motif=a["motif"],
                admin_id=a["adminId"],
                admin_nom=a["adminNom"],
                cumul_avant=a["cumulAvant"],
                cumul_apres=a["cumulApres"],
            )
        )

    for e in data.get("employes", []):
        pwd = e.get("motDePasse") or e.get("_passwordHash") or ""
        if hash_plain_passwords and pwd and not str(pwd).startswith("$2"):
            pwd_hash = hash_password(pwd)
        else:
            pwd_hash = pwd if pwd else hash_password("changeme")
        db.add(
            m.Employe(
                id=e["id"],
                nom_complet=e["nomComplet"],
                identifiant=e["identifiant"],
                mot_de_passe_hash=pwd_hash,
                role=e["role"],
                agence_id=e["agenceId"],
                droits_json=json.dumps(e.get("droits") or [], ensure_ascii=False),
                telephone=e.get("telephone"),
                email=e.get("email"),
                adresse=e.get("adresse"),
                piece_identite=e.get("pieceIdentite"),
                date_embauche=e["dateEmbauche"],
                actif=e.get("actif", True),
            )
        )

    for c in data.get("clients", []):
        db.add(
            m.Client(
                id=c["id"],
                code_client=c["codeClient"],
                agence_id=c["agenceId"],
                zone_id=c["zoneId"],
                ordre_zone=c["ordreZone"],
                nom=c["nom"],
                prenom=c["prenom"],
                sexe=c["sexe"],
                telephone=c["telephone"],
                email=c.get("email"),
                profession=c.get("profession"),
                adresse=c.get("adresse"),
                piece_identite=c.get("pieceIdentite"),
                date_inscription=c["dateInscription"],
                actif=c.get("actif", True),
            )
        )

    for c in data.get("carnets", []):
        db.add(
            m.Carnet(
                id=c["id"],
                client_id=c["clientId"],
                numero=c["numero"],
                zone_id=c["zoneId"],
                agence_id=c["agenceId"],
                type_carnet=c["typeCarnet"],
                mise=c["mise"],
                frequence=c["frequence"],
                mises_par_cycle=c.get("misesParCycle", 31),
                cycle_actuel=c.get("cycleActuel", 1),
                date_ouverture=c["dateOuverture"],
                verrouille=c.get("verrouille", False),
                retrait_active_par_admin=c.get("retraitActiveParAdmin", True),
                actif=c.get("actif", True),
            )
        )

    for x in data.get("mises", []):
        db.add(
            m.Mise(
                id=x["id"],
                carnet_id=x["carnetId"],
                cycle=x["cycle"],
                nombre_mises=x["nombreMises"],
                montant=x["montant"],
                date=x["date"],
            )
        )

    for c in data.get("comptes", []):
        db.add(
            m.Compte(
                id=c["id"],
                client_id=c["clientId"],
                type=c["type"],
                numero=c["numero"],
                solde=c.get("solde", 0),
                date_ouverture=c["dateOuverture"],
                verrouille=c.get("verrouille", False),
                part_sociale=float(c.get("partSociale") or 0),
                droit_adhesion=float(c.get("droitAdhesion") or 0),
                promotion=bool(c.get("promotion") or False),
            )
        )

    for dmd in data.get("demandesOuvertureCompte", []):
        db.add(
            m.DemandeOuvertureCompte(
                id=dmd["id"],
                client_id=dmd["clientId"],
                type=dmd["type"],
                promotion=bool(dmd.get("promotion") or False),
                part_sociale=float(dmd.get("partSociale") or 0),
                droit_adhesion=float(dmd.get("droitAdhesion") or 0),
                caissier_id=dmd["caissierId"],
                demandeur_id=dmd["demandeurId"],
                demandeur_nom=dmd["demandeurNom"],
                date_demande=dmd["dateDemande"],
                statut=dmd.get("statut", "en_attente"),
                date_traitement=dmd.get("dateTraitement"),
                compte_id=dmd.get("compteId"),
                motif_refus=dmd.get("motifRefus"),
            )
        )

    for x in data.get("mouvements", []):
        db.add(
            m.MouvementCompte(
                id=x["id"],
                compte_id=x["compteId"],
                type=x["type"],
                montant=x["montant"],
                date=x["date"],
                note=x.get("note"),
            )
        )

    for c in data.get("credits", []):
        db.add(
            m.Credit(
                id=c["id"],
                numero=c["numero"],
                client_id=c["clientId"],
                montant=c["montant"],
                taux_interet=c["tauxInteret"],
                duree_mois=c["dureeMois"],
                motif=c.get("motif"),
                date_demande=c["dateDemande"],
                date_octroi=c.get("dateOctroi"),
                statut=c["statut"],
            )
        )

    for r in data.get("remboursements", []):
        db.add(
            m.Remboursement(
                id=r["id"],
                credit_id=r["creditId"],
                montant=r["montant"],
                date=r["date"],
            )
        )

    for t in data.get("transactions", []):
        db.add(
            m.Transaction(
                id=t["id"],
                type=t["type"],
                client_id=t["clientId"],
                montant=t["montant"],
                date=t["date"],
                description=t["description"],
                operateur=t["operateur"],
                operateur_id=t["operateurId"],
                agence_id=t["agenceId"],
            )
        )

    for c in data.get("comptesCaisse", []):
        db.add(
            m.CompteCaisse(
                id=c["id"],
                employe_id=c["employeId"],
                agence_id=c["agenceId"],
                numero=c["numero"],
                solde=c.get("solde", 0),
                cumul_manquant=c.get("cumulManquant", 0),
                cumul_surplus=c.get("cumulSurplus", 0),
                date_ouverture=c["dateOuverture"],
                actif=c.get("actif", True),
            )
        )

    for x in data.get("mouvementsCompteCaisse", []):
        db.add(
            m.MouvementCompteCaisse(
                id=x["id"],
                compte_caisse_id=x["compteCaisseId"],
                employe_id=x["employeId"],
                type=x["type"],
                montant=x["montant"],
                sens=x["sens"],
                solde_apres=x["soldeApres"],
                date=x["date"],
                description=x["description"],
                transaction_id=x.get("transactionId"),
                operateur_id=x["operateurId"],
                operateur_nom=x["operateurNom"],
            )
        )

    for a in data.get("ajustementsCompteCaisse", []):
        db.add(
            m.AjustementCompteCaisse(
                id=a["id"],
                compte_caisse_id=a["compteCaisseId"],
                employe_id=a["employeId"],
                date=a["date"],
                type=a["type"],
                montant=a["montant"],
                motif=a["motif"],
                admin_id=a["adminId"],
                admin_nom=a["adminNom"],
                cumul_avant=a["cumulAvant"],
                cumul_apres=a["cumulApres"],
            )
        )

    for o in data.get("ouverturesCaisse", []):
        db.add(
            m.OuvertureCaisse(
                id=o["id"],
                employe_id=o["employeId"],
                employe_nom=o["employeNom"],
                agence_id=o["agenceId"],
                journee=o["journee"],
                solde_ouverture=o["soldeOuverture"],
                date_ouverture=o["dateOuverture"],
                ouvert_par_id=o["ouvertParId"],
                ouvert_par_nom=o["ouvertParNom"],
                note=o.get("note"),
            )
        )

    for a in data.get("arretsCaisse", []):
        db.add(
            m.ArretCaisse(
                id=a["id"],
                employe_id=a["employeId"],
                employe_nom=a["employeNom"],
                agence_id=a["agenceId"],
                journee=a["journee"],
                date_cloture=a.get("dateCloture") or a.get("date") or "",
                date=a.get("date"),
                debut_periode=a["debutPeriode"],
                nombre_operations=a["nombreOperations"],
                total_entrees=a["totalEntrees"],
                total_sorties=a["totalSorties"],
                solde_ouverture=a["soldeOuverture"],
                solde_theorique=a["soldeTheorique"],
                montant_compte=a["montantCompte"],
                ecart=a["ecart"],
                note=a.get("note"),
                valide_par_id=a.get("valideParId"),
                valide_par_nom=a.get("valideParNom"),
            )
        )

    for j in data.get("journalConnexions", []):
        db.add(
            m.JournalConnexion(
                id=j["id"],
                employe_id=j["employeId"],
                employe_nom=j["employeNom"],
                agence_id=j["agenceId"],
                date=j["date"],
                type=j["type"],
            )
        )

    compteurs = data.get("compteurs") or {}
    for cle, valeur in compteurs.items():
        db.add(m.Compteur(cle=str(cle), valeur=int(valeur)))

    for zone_id, valeur in (data.get("compteursOrdreZone") or {}).items():
        db.add(m.CompteurOrdreZone(zone_id=zone_id, valeur=int(valeur)))

    db.commit()


def load_state(db: Session, *, include_password_hashes: bool = False) -> dict[str, Any]:
    """Exporte AppData camelCase. motDePasse vide sauf include_password_hashes (hash en _passwordHash)."""
    employes = []
    for e in db.query(m.Employe).all():
        row = {
            "id": e.id,
            "nomComplet": e.nom_complet,
            "identifiant": e.identifiant,
            "motDePasse": "",
            "role": e.role,
            "agenceId": e.agence_id,
            "droits": json.loads(e.droits_json or "[]"),
            "telephone": e.telephone,
            "email": e.email,
            "adresse": e.adresse,
            "pieceIdentite": e.piece_identite,
            "dateEmbauche": e.date_embauche,
            "actif": e.actif,
        }
        if include_password_hashes:
            row["_passwordHash"] = e.mot_de_passe_hash
        employes.append(row)

    return {
        "agences": [
            {
                "id": a.id,
                "code": a.code,
                "nom": a.nom,
                "adresse": a.adresse,
                "telephone": a.telephone,
                "chefEmployeId": a.chef_employe_id,
                "actif": a.actif,
            }
            for a in db.query(m.Agence).all()
        ],
        "zones": [
            {
                "id": z.id,
                "agenceId": z.agence_id,
                "code": z.code,
                "nom": z.nom,
                "actif": z.actif,
            }
            for z in db.query(m.Zone).all()
        ],
        "comptesZoneTontine": [
            {
                "id": c.id,
                "zoneId": c.zone_id,
                "cumulManquant": c.cumul_manquant,
                "cumulSurplus": c.cumul_surplus,
                "actif": c.actif,
            }
            for c in db.query(m.CompteZoneTontine).all()
        ],
        "journeesCompteZone": [
            {
                "id": j.id,
                "compteZoneId": j.compte_zone_id,
                "zoneId": j.zone_id,
                "date": j.date,
                "montantReel": j.montant_reel,
                "montantTheorique": j.montant_theorique,
                "ecart": j.ecart,
                "statut": j.statut,
                "cloturee": j.cloturee,
                "dateSaisieReel": j.date_saisie_reel,
                "dateCloture": j.date_cloture,
                "operateurId": j.operateur_id,
                "operateurNom": j.operateur_nom,
                "note": j.note,
            }
            for j in db.query(m.JourneeCompteZone).all()
        ],
        "ajustementsCompteZone": [
            {
                "id": a.id,
                "compteZoneId": a.compte_zone_id,
                "zoneId": a.zone_id,
                "date": a.date,
                "type": a.type,
                "montant": a.montant,
                "motif": a.motif,
                "adminId": a.admin_id,
                "adminNom": a.admin_nom,
                "cumulAvant": a.cumul_avant,
                "cumulApres": a.cumul_apres,
            }
            for a in db.query(m.AjustementCompteZone).all()
        ],
        "employes": employes,
        "clients": [
            {
                "id": c.id,
                "codeClient": c.code_client,
                "agenceId": c.agence_id,
                "zoneId": c.zone_id,
                "ordreZone": c.ordre_zone,
                "nom": c.nom,
                "prenom": c.prenom,
                "sexe": c.sexe,
                "telephone": c.telephone,
                "email": c.email,
                "profession": c.profession,
                "adresse": c.adresse,
                "pieceIdentite": c.piece_identite,
                "dateInscription": c.date_inscription,
                "actif": c.actif,
            }
            for c in db.query(m.Client).order_by(m.Client.zone_id, m.Client.ordre_zone, m.Client.code_client).all()
        ],
        "carnets": [
            {
                "id": c.id,
                "clientId": c.client_id,
                "numero": c.numero,
                "zoneId": c.zone_id,
                "agenceId": c.agence_id,
                "typeCarnet": c.type_carnet,
                "mise": c.mise,
                "frequence": c.frequence,
                "misesParCycle": c.mises_par_cycle,
                "cycleActuel": c.cycle_actuel,
                "dateOuverture": c.date_ouverture,
                "verrouille": c.verrouille,
                "retraitActiveParAdmin": c.retrait_active_par_admin,
                "actif": c.actif,
            }
            for c in db.query(m.Carnet).all()
        ],
        "mises": [
            {
                "id": x.id,
                "carnetId": x.carnet_id,
                "cycle": x.cycle,
                "nombreMises": x.nombre_mises,
                "montant": x.montant,
                "date": x.date,
            }
            for x in db.query(m.Mise).all()
        ],
        "comptes": [
            {
                "id": c.id,
                "clientId": c.client_id,
                "type": c.type,
                "numero": c.numero,
                "solde": c.solde,
                "dateOuverture": c.date_ouverture,
                "verrouille": c.verrouille,
                "partSociale": getattr(c, "part_sociale", 0) or 0,
                "droitAdhesion": getattr(c, "droit_adhesion", 0) or 0,
                "promotion": bool(getattr(c, "promotion", False)),
            }
            for c in db.query(m.Compte).all()
        ],
        "demandesOuvertureCompte": [
            {
                "id": d.id,
                "clientId": d.client_id,
                "type": d.type,
                "promotion": d.promotion,
                "partSociale": d.part_sociale,
                "droitAdhesion": d.droit_adhesion,
                "caissierId": d.caissier_id,
                "demandeurId": d.demandeur_id,
                "demandeurNom": d.demandeur_nom,
                "dateDemande": d.date_demande,
                "statut": d.statut,
                "dateTraitement": d.date_traitement,
                "compteId": d.compte_id,
                "motifRefus": d.motif_refus,
            }
            for d in db.query(m.DemandeOuvertureCompte).all()
        ],
        "mouvements": [
            {
                "id": x.id,
                "compteId": x.compte_id,
                "type": x.type,
                "montant": x.montant,
                "date": x.date,
                "note": x.note,
            }
            for x in db.query(m.MouvementCompte).all()
        ],
        "credits": [
            {
                "id": c.id,
                "numero": c.numero,
                "clientId": c.client_id,
                "montant": c.montant,
                "tauxInteret": c.taux_interet,
                "dureeMois": c.duree_mois,
                "motif": c.motif,
                "dateDemande": c.date_demande,
                "dateOctroi": c.date_octroi,
                "statut": c.statut,
            }
            for c in db.query(m.Credit).all()
        ],
        "remboursements": [
            {
                "id": r.id,
                "creditId": r.credit_id,
                "montant": r.montant,
                "date": r.date,
            }
            for r in db.query(m.Remboursement).all()
        ],
        "transactions": [
            {
                "id": t.id,
                "type": t.type,
                "clientId": t.client_id,
                "montant": t.montant,
                "date": t.date,
                "description": t.description,
                "operateur": t.operateur,
                "operateurId": t.operateur_id,
                "agenceId": t.agence_id,
            }
            for t in db.query(m.Transaction).all()
        ],
        "comptesCaisse": [
            {
                "id": c.id,
                "employeId": c.employe_id,
                "agenceId": c.agence_id,
                "numero": c.numero,
                "solde": c.solde,
                "cumulManquant": c.cumul_manquant,
                "cumulSurplus": c.cumul_surplus,
                "dateOuverture": c.date_ouverture,
                "actif": c.actif,
            }
            for c in db.query(m.CompteCaisse).all()
        ],
        "mouvementsCompteCaisse": [
            {
                "id": x.id,
                "compteCaisseId": x.compte_caisse_id,
                "employeId": x.employe_id,
                "type": x.type,
                "montant": x.montant,
                "sens": x.sens,
                "soldeApres": x.solde_apres,
                "date": x.date,
                "description": x.description,
                "transactionId": x.transaction_id,
                "operateurId": x.operateur_id,
                "operateurNom": x.operateur_nom,
            }
            for x in db.query(m.MouvementCompteCaisse).all()
        ],
        "ajustementsCompteCaisse": [
            {
                "id": a.id,
                "compteCaisseId": a.compte_caisse_id,
                "employeId": a.employe_id,
                "date": a.date,
                "type": a.type,
                "montant": a.montant,
                "motif": a.motif,
                "adminId": a.admin_id,
                "adminNom": a.admin_nom,
                "cumulAvant": a.cumul_avant,
                "cumulApres": a.cumul_apres,
            }
            for a in db.query(m.AjustementCompteCaisse).all()
        ],
        "ouverturesCaisse": [
            {
                "id": o.id,
                "employeId": o.employe_id,
                "employeNom": o.employe_nom,
                "agenceId": o.agence_id,
                "journee": o.journee,
                "soldeOuverture": o.solde_ouverture,
                "dateOuverture": o.date_ouverture,
                "ouvertParId": o.ouvert_par_id,
                "ouvertParNom": o.ouvert_par_nom,
                "note": o.note,
            }
            for o in db.query(m.OuvertureCaisse).all()
        ],
        "arretsCaisse": [
            {
                "id": a.id,
                "employeId": a.employe_id,
                "employeNom": a.employe_nom,
                "agenceId": a.agence_id,
                "journee": a.journee,
                "dateCloture": a.date_cloture,
                "date": a.date,
                "debutPeriode": a.debut_periode,
                "nombreOperations": a.nombre_operations,
                "totalEntrees": a.total_entrees,
                "totalSorties": a.total_sorties,
                "soldeOuverture": a.solde_ouverture,
                "soldeTheorique": a.solde_theorique,
                "montantCompte": a.montant_compte,
                "ecart": a.ecart,
                "note": a.note,
                "valideParId": a.valide_par_id,
                "valideParNom": a.valide_par_nom,
            }
            for a in db.query(m.ArretCaisse).all()
        ],
        "journalConnexions": [
            {
                "id": j.id,
                "employeId": j.employe_id,
                "employeNom": j.employe_nom,
                "agenceId": j.agence_id,
                "date": j.date,
                "type": j.type,
            }
            for j in db.query(m.JournalConnexion).all()
        ],
        "compteursOrdreZone": {r.zone_id: r.valeur for r in db.query(m.CompteurOrdreZone).all()},
        "compteurs": {
            "client": 0,
            "compte": 0,
            "credit": 0,
            "compteCaisse": 0,
            **{r.cle: r.valeur for r in db.query(m.Compteur).all()},
        },
    }


def get_employe_by_identifiant(db: Session, identifiant: str) -> m.Employe | None:
    return db.query(m.Employe).filter(m.Employe.identifiant == identifiant.strip()).first()


def get_employe(db: Session, employe_id: str) -> m.Employe | None:
    return db.query(m.Employe).filter(m.Employe.id == employe_id).first()


def employe_public(e: m.Employe) -> dict[str, Any]:
    return {
        "id": e.id,
        "nomComplet": e.nom_complet,
        "identifiant": e.identifiant,
        "motDePasse": "",
        "role": e.role,
        "agenceId": e.agence_id,
        "droits": json.loads(e.droits_json or "[]"),
        "telephone": e.telephone,
        "email": e.email,
        "adresse": e.adresse,
        "pieceIdentite": e.piece_identite,
        "dateEmbauche": e.date_embauche,
        "actif": e.actif,
    }
