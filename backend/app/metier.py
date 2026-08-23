"""Helpers métier (port de src/metier.ts)."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

TYPES_SORTIE = ["retrait_tontine", "retrait_compte", "octroi_credit"]
TYPES_OPERATION_CAISSE = [
    "vente_carnet",
    "mise_tontine",
    "retrait_tontine",
    "commission_tontine",
    "depot_compte",
    "retrait_compte",
    "octroi_credit",
    "remboursement_credit",
    "part_sociale",
    "droit_adhesion",
]
CARNETS_RETRAIT_6_MOIS = ["carte_enfants", "carte_bloquee"]
PRIX_CARNET = 300
CARREAUX_PAR_CYCLE = 31
CYCLES_PAR_CARNET = 12
MOIS_MIN_RETRAIT_CARTE = 6


def aujourd_hui_iso() -> str:
    d = datetime.now()
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}"


def maintenant() -> str:
    return datetime.now().isoformat()


def est_operation_caisse(t: str) -> bool:
    return t in TYPES_OPERATION_CAISSE


def compte_caisse_de(comptes: list, employe_id: str) -> dict | None:
    return next((c for c in comptes if c.get("employeId") == employe_id and c.get("actif")), None)


def compte_zone_de(comptes: list, zone_id: str) -> dict | None:
    return next((c for c in comptes if c.get("zoneId") == zone_id and c.get("actif", True)), None)


def delta_solde_operation_caisse(type_: str, montant: float) -> float:
    if not est_operation_caisse(type_):
        return 0.0
    return -montant if type_ in TYPES_SORTIE else montant


def carreaux_nets(carnet: dict, mises: list, cycle: int | None = None) -> int:
    c = cycle if cycle is not None else carnet["cycleActuel"]
    return sum(m["nombreMises"] for m in mises if m["carnetId"] == carnet["id"] and m["cycle"] == c)


def calculer_mises_depuis_montant(montant: float, mise: float) -> dict[str, Any]:
    if mise <= 0:
        return {"ok": False, "erreur": "Mise invalide."}
    if montant <= 0:
        return {"ok": False, "erreur": "Montant invalide."}
    if abs(montant % mise) > 1e-6:
        return {
            "ok": False,
            "erreur": f"Le montant doit etre un multiple de la mise ({int(mise)} FCFA).",
        }
    return {"ok": True, "nombreMises": int(round(montant / mise))}


def journee_zone_du_jour(journees: list, zone_id: str, date_iso: str) -> dict | None:
    return next((j for j in journees if j["zoneId"] == zone_id and j["date"] == date_iso), None)


def statut_depuis_ecart(ecart: float) -> str:
    if ecart == 0:
        return "ok"
    return "manquant" if ecart < 0 else "surplus"


def depots_tontine_zone_jour(zone_id: str, date_iso: str, clients: list, transactions: list) -> float:
    ids = {c["id"] for c in clients if c.get("zoneId") == zone_id}
    return sum(
        t["montant"]
        for t in transactions
        if t["type"] in ("mise_tontine", "commission_tontine")
        and t["clientId"] in ids
        and t["date"][:10] == date_iso
    )


def ouverture_caisse_du_jour(ouvertures: list, employe_id: str, journee: str) -> dict | None:
    return next((o for o in ouvertures if o["employeId"] == employe_id and o["journee"] == journee), None)


def arret_caisse_du_jour(arrets: list, employe_id: str, journee: str) -> dict | None:
    return next((a for a in arrets if a["employeId"] == employe_id and a.get("journee") == journee), None)


def jour_iso_depuis_date(date: str) -> str:
    return date[:10]


def journees_ouvertes_en_attente_cloture(
    employe_id: str, ouvertures: list, arrets: list, avant_jour: str
) -> list[str]:
    arretes = {
        a.get("journee") or jour_iso_depuis_date(a.get("dateCloture") or a.get("date") or "")
        for a in arrets
        if a["employeId"] == employe_id
    }
    return sorted(
        {
            o["journee"]
            for o in ouvertures
            if o["employeId"] == employe_id and o["journee"] < avant_jour and o["journee"] not in arretes
        }
    )


def journees_caisse_en_retard(
    employe_id: str,
    transactions: list,
    arrets: list,
    ouvertures: list,
    avant_jour: str | None = None,
) -> list[str]:
    avant = avant_jour or aujourd_hui_iso()
    jours_ops = {
        jour_iso_depuis_date(t["date"])
        for t in transactions
        if t.get("operateurId") == employe_id
        and est_operation_caisse(t["type"])
        and jour_iso_depuis_date(t["date"]) < avant
    }
    jours_ouv = {o["journee"] for o in ouvertures if o["employeId"] == employe_id and o["journee"] < avant}
    arretes = {
        a.get("journee") or jour_iso_depuis_date(a.get("dateCloture") or a.get("date") or "")
        for a in arrets
        if a["employeId"] == employe_id
    }
    return sorted((jours_ops | jours_ouv) - arretes)


def message_blocage_caisse_journaliere(
    employe_id: str, transactions: list, arrets: list, ouvertures: list
) -> str | None:
    auj = aujourd_hui_iso()
    retards = journees_caisse_en_retard(employe_id, transactions, arrets, ouvertures, auj)
    if retards:
        return f"Arret de caisse en retard pour le {retards[0]}. Les operations sont bloquees."
    if not ouverture_caisse_du_jour(ouvertures, employe_id, auj):
        return "La journee de caisse n'est pas ouverte. Contactez l'admin ou le chef d'agence."
    if arret_caisse_du_jour(arrets, employe_id, auj):
        return "La caisse du jour est deja cloturee."
    return None


def eligibilite_retrait_carnet(carnet: dict, mises: list) -> dict[str, Any]:
    if carnet["typeCarnet"] not in CARNETS_RETRAIT_6_MOIS:
        return {"autorise": True}
    if carnet.get("retraitActiveParAdmin"):
        return {"autorise": True}
    dates = sorted(m["date"] for m in mises if m["carnetId"] == carnet["id"] and m["nombreMises"] > 0)
    debut = dates[0] if dates else carnet["dateOuverture"]
    raw = debut.replace("Z", "+00:00") if "T" in debut else debut
    deb = datetime.fromisoformat(raw) + timedelta(days=30 * MOIS_MIN_RETRAIT_CARTE)
    return {"autorise": False, "dateDeblocage": deb.isoformat()}


def situation_caisse(
    employe_id: str,
    transactions: list,
    arrets: list,
    journee: str,
    comptes_caisse: list,
    mouvements: list,
    ouvertures: list,
) -> dict[str, Any]:
    arret = arret_caisse_du_jour(arrets, employe_id, journee)
    ouverture = ouverture_caisse_du_jour(ouvertures, employe_id, journee)
    periode = sorted(
        [
            t
            for t in transactions
            if t.get("operateurId") == employe_id
            and est_operation_caisse(t["type"])
            and jour_iso_depuis_date(t["date"]) == journee
        ],
        key=lambda t: t["date"],
        reverse=True,
    )
    total_entrees = sum(t["montant"] for t in periode if t["type"] not in TYPES_SORTIE)
    total_sorties = sum(t["montant"] for t in periode if t["type"] in TYPES_SORTIE)
    compte = compte_caisse_de(comptes_caisse, employe_id)
    if arret and arret.get("soldeOuverture") is not None:
        solde_ouv = arret["soldeOuverture"]
        solde_th = arret["soldeTheorique"]
    elif ouverture:
        solde_ouv = ouverture["soldeOuverture"]
        solde_th = float(compte.get("solde", 0)) if compte else 0.0
    else:
        solde_ouv = 0
        solde_th = float(compte.get("solde", 0)) if compte else 0.0
    return {
        "transactions": periode,
        "nombreOperations": len(periode),
        "totalEntrees": total_entrees,
        "totalSorties": total_sorties,
        "soldeOuverture": solde_ouv,
        "soldeFermetureTheorique": solde_th,
        "ouverte": bool(ouverture),
        "cloturee": bool(arret),
        "arretDuJour": arret,
        "ouvertureDuJour": ouverture,
        "journeesEnRetard": journees_caisse_en_retard(employe_id, transactions, arrets, ouvertures),
    }
