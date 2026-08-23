"""Moteur métier — mutations AppData (port de src/store.tsx)."""
from __future__ import annotations

import copy
import random
import re
import time
from typing import Any

from sqlalchemy.orm import Session

from . import metier as M
from .repository import load_state, replace_state
from .seed import seed_database

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


def uid() -> str:
    return f"{random.randrange(1_000_000):x}{int(time.time() * 1000):x}"[-16:]


def pad4(n: int) -> str:
    return f"{n:04d}"


def pad2(n: int | str) -> str:
    return str(n).zfill(2)


def numero_carnet(code_zone: str, ordre: int) -> str:
    return f"{pad2(code_zone)}{pad4(ordre)}"


def numero_client(ordre: int) -> str:
    return pad4(ordre)


def numero_compte_solde(ordre: int) -> str:
    return f"B{pad4(ordre)}"


def numero_compte_caisse(ordre: int) -> str:
    return f"CAI-{pad4(ordre)}"


def _public(d: dict) -> dict:
    out = copy.deepcopy(d)
    for e in out.get("employes", []):
        e["motDePasse"] = ""
        e.pop("_passwordHash", None)
    return out


def _persist(db: Session, d: dict) -> dict:
    for e in d.get("employes", []):
        h = e.pop("_passwordHash", None)
        if h:
            e["motDePasse"] = h
    replace_state(db, d, hash_plain_passwords=True)
    return _public(load_state(db))


def _user(d: dict, user_id: str) -> dict | None:
    return next((e for e in d["employes"] if e["id"] == user_id and e.get("actif")), None)


def _est_admin(u: dict) -> bool:
    return u.get("role") == "admin"


def _est_chef(u: dict) -> bool:
    return u.get("role") == "chef_agence"


def _est_caissier(u: dict) -> bool:
    return u.get("role") == "caissier"


def _a_droit(u: dict, droit: str) -> bool:
    if _est_admin(u):
        return True
    return droit in (u.get("droits") or [])


def _employe_a_compte_caisse(role: str) -> bool:
    return role in ("caissier", "chef_agence")


def _ouvrir_compte_caisse_si_besoin(d: dict, employe_id: str) -> dict:
    if M.compte_caisse_de(d["comptesCaisse"], employe_id):
        return d
    emp = next((e for e in d["employes"] if e["id"] == employe_id), None)
    if not emp or not _employe_a_compte_caisse(emp["role"]):
        return d
    ordre = int(d.get("compteurs", {}).get("compteCaisse", 0)) + 1
    compte = {
        "id": uid(),
        "employeId": employe_id,
        "agenceId": emp["agenceId"],
        "numero": numero_compte_caisse(ordre),
        "solde": 0,
        "cumulManquant": 0,
        "cumulSurplus": 0,
        "dateOuverture": M.maintenant(),
        "actif": True,
    }
    d = copy.deepcopy(d)
    d["comptesCaisse"] = [*d["comptesCaisse"], compte]
    d["compteurs"] = {**d["compteurs"], "compteCaisse": ordre}
    return d


def _appliquer_tx_caisse(d: dict, tx: dict) -> dict:
    if not M.est_operation_caisse(tx["type"]) or not tx.get("operateurId"):
        return d
    next_d = _ouvrir_compte_caisse_si_besoin(d, tx["operateurId"])
    compte = M.compte_caisse_de(next_d["comptesCaisse"], tx["operateurId"])
    if not compte:
        return next_d
    delta = M.delta_solde_operation_caisse(tx["type"], tx["montant"])
    if delta == 0:
        return next_d
    solde_apres = compte["solde"] + delta
    mouvement = {
        "id": uid(),
        "compteCaisseId": compte["id"],
        "employeId": tx["operateurId"],
        "type": "entree_operation" if delta > 0 else "sortie_operation",
        "montant": abs(delta),
        "sens": "credit" if delta > 0 else "debit",
        "soldeApres": solde_apres,
        "date": tx["date"],
        "description": tx["description"],
        "transactionId": tx["id"],
        "operateurId": tx["operateurId"],
        "operateurNom": tx["operateur"],
    }
    next_d = copy.deepcopy(next_d)
    next_d["comptesCaisse"] = [
        {**c, "solde": solde_apres} if c["id"] == compte["id"] else c for c in next_d["comptesCaisse"]
    ]
    next_d["mouvementsCompteCaisse"] = [mouvement, *next_d["mouvementsCompteCaisse"]]
    return next_d


def _enregistrer_tx(d: dict, nouvelles: list[dict]) -> dict:
    apres = d
    for tx in nouvelles:
        apres = _appliquer_tx_caisse(apres, tx)
    apres = copy.deepcopy(apres)
    apres["transactions"] = [*nouvelles, *apres["transactions"]]
    return apres


def _mk_tx(u: dict, t: dict) -> dict:
    return {
        **t,
        "id": uid(),
        "operateur": u["nomComplet"],
        "operateurId": u["id"],
        "agenceId": u["agenceId"],
    }


def _nom_client(d: dict, client_id: str) -> str:
    c = next((x for x in d["clients"] if x["id"] == client_id), None)
    return f"{c['prenom']} {c['nom']}" if c else "Inconnu"


def _verif_caisse(d: dict, u: dict) -> str | None:
    if _est_admin(u):
        return None
    if not _employe_a_compte_caisse(u["role"]):
        return None
    return M.message_blocage_caisse_journaliere(
        u["id"], d["transactions"], d["arretsCaisse"], d.get("ouverturesCaisse") or []
    )


def _verif_solde_sortie(d: dict, u: dict, montant: float) -> str | None:
    if _est_admin(u):
        return None
    compte = M.compte_caisse_de(d["comptesCaisse"], u["id"])
    solde = compte["solde"] if compte else 0
    if solde < montant:
        return "Solde de caisse insuffisant."
    return None


def run_mutation(db: Session, current_user_id: str, action: str, payload: dict) -> dict[str, Any]:
    payload = payload or {}
    if action == "reinitialiserDemo":
        seed_database(db)
        return {"ok": True, "data": _public(load_state(db))}

    d = load_state(db, include_password_hashes=True)
    u = _user(d, current_user_id)
    if not u:
        return {"erreur": "Non connecte."}

    handler = ACTIONS.get(action)
    if not handler:
        return {"erreur": f"Action inconnue: {action}"}

    try:
        result = handler(d, u, payload)
    except Exception as exc:  # noqa: BLE001
        return {"erreur": str(exc)}

    if isinstance(result, dict) and result.get("erreur") and "data" not in result:
        return {"erreur": result["erreur"]}

    if isinstance(result, tuple):
        err, new_d, extra = result[0], result[1], (result[2] if len(result) > 2 else {})
        if err:
            return {"erreur": err}
        data = _persist(db, new_d)
        _sync_compta(db, new_d, u)
        return {"ok": True, "data": data, **(extra or {})}

    if isinstance(result, dict) and "data" in result:
        data = _persist(db, result["data"])
        _sync_compta(db, result["data"], u)
        out = {"ok": True, "data": data}
        for k, v in result.items():
            if k not in ("data", "erreur"):
                out[k] = v
        return out

    # handler returned new state dict directly
    if isinstance(result, dict) and "employes" in result:
        data = _persist(db, result)
        _sync_compta(db, result, u)
        return {"ok": True, "data": data}

    return {"erreur": "Resultat de mutation invalide."}


def _sync_compta(db: Session, state: dict, user: dict) -> None:
    try:
        from .comptabilite import sync_auto_from_state

        sync_auto_from_state(db, state, user)
    except Exception:  # noqa: BLE001
        # Ne bloque pas l'opération métier si la compta échoue
        pass


# ---- Actions ----

def ajouter_agence(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    code = (p.get("code") or "").strip()
    if any(a["code"] == code for a in d["agences"]):
        return {"erreur": "Code agence deja utilise."}
    d = copy.deepcopy(d)
    d["agences"].append(
        {
            "id": uid(),
            "code": code,
            "nom": p.get("nom", ""),
            "adresse": p.get("adresse"),
            "telephone": p.get("telephone"),
            "chefEmployeId": p.get("chefEmployeId"),
            "actif": True,
        }
    )
    return d


def modifier_agence(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    patch = p.get("patch") or {}
    d = copy.deepcopy(d)
    d["agences"] = [{**a, **patch} if a["id"] == id_ else a for a in d["agences"]]
    return d


def basculer_actif_agence(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    d = copy.deepcopy(d)
    d["agences"] = [{**a, "actif": not a["actif"]} if a["id"] == id_ else a for a in d["agences"]]
    return d


def ajouter_zone(d, u, p):
    if not (_est_admin(u) or _a_droit(u, "gerer_zones")):
        return {"erreur": "Droit insuffisant."}
    code = (p.get("code") or "").strip()
    if not re.match(r"^\d{2}$", code):
        return {"erreur": "Le numero de zone doit etre sur 2 chiffres (ex. 01)."}
    if any(z["code"] == code for z in d["zones"]):
        return {"erreur": "Ce numero de zone existe deja."}
    if not any(a["id"] == p.get("agenceId") for a in d["agences"]):
        return {"erreur": "Agence introuvable."}
    zid = uid()
    d = copy.deepcopy(d)
    d["zones"].append(
        {
            "id": zid,
            "agenceId": p["agenceId"],
            "code": code,
            "nom": (p.get("nom") or "").strip() or None,
            "actif": True,
        }
    )
    d["comptesZoneTontine"].append(
        {"id": uid(), "zoneId": zid, "cumulManquant": 0, "cumulSurplus": 0, "actif": True}
    )
    d["compteursOrdreZone"][zid] = 0
    return (None, d, {})


def modifier_zone(d, u, p):
    if not (_est_admin(u) or _a_droit(u, "gerer_zones")):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    patch = dict(p.get("patch") or {})
    zone = next((z for z in d["zones"] if z["id"] == id_), None)
    if not zone:
        return {"erreur": "Zone introuvable."}
    code = patch["code"].strip() if "code" in patch else zone["code"]
    if "code" in patch and not re.match(r"^\d{2}$", code):
        return {"erreur": "Le numero de zone doit etre sur 2 chiffres (ex. 01)."}
    if any(z["id"] != id_ and z["code"] == code for z in d["zones"]):
        return {"erreur": "Ce numero de zone existe deja."}
    d = copy.deepcopy(d)
    def upd(z):
        if z["id"] != id_:
            return z
        n = {**z, **patch, "code": code}
        if "nom" in patch:
            n["nom"] = (patch["nom"] or "").strip() or None
        return n
    d["zones"] = [upd(z) for z in d["zones"]]
    return (None, d, {})


def basculer_actif_zone(d, u, p):
    id_ = p["id"]
    d = copy.deepcopy(d)
    d["zones"] = [{**z, "actif": not z["actif"]} if z["id"] == id_ else z for z in d["zones"]]
    return d


def saisir_montant_reel_zone(d, u, p):
    if not _a_droit(u, "operer_comptes") and not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    zone_id = p["zoneId"]
    montant = float(p["montantReel"])
    if montant < 0:
        return {"erreur": "Montant invalide."}
    jour = p.get("dateIso") or M.aujourd_hui_iso()
    note = p.get("note")
    zone = next((z for z in d["zones"] if z["id"] == zone_id), None)
    if not zone:
        return {"erreur": "Zone introuvable."}
    if not _est_admin(u) and zone["agenceId"] != u["agenceId"]:
        return {"erreur": "Cette zone n'appartient pas a votre agence."}
    d = copy.deepcopy(d)
    compte = M.compte_zone_de(d["comptesZoneTontine"], zone_id)
    if not compte:
        compte = {"id": uid(), "zoneId": zone_id, "cumulManquant": 0, "cumulSurplus": 0, "actif": True}
        d["comptesZoneTontine"].append(compte)
    existante = next((j for j in d["journeesCompteZone"] if j["zoneId"] == zone_id and j["date"] == jour), None)
    if existante and existante.get("cloturee"):
        return {"erreur": "Cette journee est deja cloturee."}
    now = M.maintenant()
    if existante:
        d["journeesCompteZone"] = [
            {
                **j,
                "montantReel": montant,
                "note": (note or "").strip() or j.get("note"),
                "dateSaisieReel": now,
                "operateurId": u["id"],
                "operateurNom": u["nomComplet"],
            }
            if j["id"] == existante["id"]
            else j
            for j in d["journeesCompteZone"]
        ]
    else:
        d["journeesCompteZone"].append(
            {
                "id": uid(),
                "compteZoneId": compte["id"],
                "zoneId": zone_id,
                "date": jour,
                "montantReel": montant,
                "montantTheorique": 0,
                "ecart": 0,
                "statut": "en_cours",
                "cloturee": False,
                "dateSaisieReel": now,
                "operateurId": u["id"],
                "operateurNom": u["nomComplet"],
                "note": (note or "").strip() or None,
            }
        )
    return (None, d, {})


def cloturer_journee_zone(d, u, p):
    if not _a_droit(u, "operer_comptes") and not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    zone_id = p["zoneId"]
    jour = p.get("dateIso") or M.aujourd_hui_iso()
    zone = next((z for z in d["zones"] if z["id"] == zone_id), None)
    if not zone:
        return {"erreur": "Zone introuvable."}
    if not _est_admin(u) and zone["agenceId"] != u["agenceId"]:
        return {"erreur": "Cette zone n'appartient pas a votre agence."}
    d = copy.deepcopy(d)
    journee = M.journee_zone_du_jour(d["journeesCompteZone"], zone_id, jour)
    if not journee:
        return {"erreur": "Saisissez d'abord le montant reel."}
    if journee.get("cloturee"):
        return {"erreur": "Journee deja cloturee."}
    theorique = M.depots_tontine_zone_jour(zone_id, jour, d["clients"], d["transactions"])
    ecart = journee["montantReel"] - theorique
    statut = M.statut_depuis_ecart(ecart)
    d["journeesCompteZone"] = [
        {
            **j,
            "montantTheorique": theorique,
            "ecart": ecart,
            "statut": statut,
            "cloturee": True,
            "dateCloture": M.maintenant(),
        }
        if j["id"] == journee["id"]
        else j
        for j in d["journeesCompteZone"]
    ]
    compte = M.compte_zone_de(d["comptesZoneTontine"], zone_id)
    if compte and ecart != 0:
        cm = compte.get("cumulManquant", 0)
        cs = compte.get("cumulSurplus", 0)
        if ecart < 0:
            cm += abs(ecart)
        else:
            cs += ecart
        d["comptesZoneTontine"] = [
            {**c, "cumulManquant": cm, "cumulSurplus": cs} if c["id"] == compte["id"] else c
            for c in d["comptesZoneTontine"]
        ]
    return (None, d, {})


def ajuster_cumul_compte_zone(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Reserve a l'administrateur."}
    zone_id = p["zoneId"]
    type_ = p["type"]
    montant = float(p["montant"])
    motif = (p.get("motif") or "").strip()
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    if not motif:
        return {"erreur": "Motif obligatoire."}
    d = copy.deepcopy(d)
    compte = M.compte_zone_de(d["comptesZoneTontine"], zone_id)
    if not compte:
        return {"erreur": "Compte zone introuvable."}
    avant = compte["cumulManquant"] if type_ == "manquant" else compte["cumulSurplus"]
    if montant > avant:
        return {"erreur": "Montant superieur au cumul."}
    apres = avant - montant
    d["comptesZoneTontine"] = [
        {
            **c,
            "cumulManquant": apres if type_ == "manquant" else c["cumulManquant"],
            "cumulSurplus": apres if type_ == "surplus" else c["cumulSurplus"],
        }
        if c["id"] == compte["id"]
        else c
        for c in d["comptesZoneTontine"]
    ]
    d["ajustementsCompteZone"] = [
        {
            "id": uid(),
            "compteZoneId": compte["id"],
            "zoneId": zone_id,
            "date": M.maintenant(),
            "type": type_,
            "montant": montant,
            "motif": motif,
            "adminId": u["id"],
            "adminNom": u["nomComplet"],
            "cumulAvant": avant,
            "cumulApres": apres,
        },
        *d["ajustementsCompteZone"],
    ]
    return (None, d, {})


def ajouter_client(d, u, p):
    if not _a_droit(u, "gerer_clients") and not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    zone_id = p.get("zoneId")
    zone = next((z for z in d["zones"] if z["id"] == zone_id), None)
    if not zone:
        return {"erreur": "Zone introuvable."}
    d = copy.deepcopy(d)
    ordre_zone = int(d.get("compteursOrdreZone", {}).get(zone_id, 0)) + 1
    ordre_client = int(d["compteurs"].get("client", 0)) + 1
    cid = uid()
    d["clients"].append(
        {
            "id": cid,
            "codeClient": numero_client(ordre_client),
            "agenceId": zone["agenceId"],
            "zoneId": zone_id,
            "ordreZone": ordre_zone,
            "nom": p.get("nom", ""),
            "prenom": p.get("prenom", ""),
            "sexe": p.get("sexe", "M"),
            "telephone": p.get("telephone", ""),
            "email": p.get("email"),
            "profession": p.get("profession"),
            "adresse": p.get("adresse"),
            "pieceIdentite": p.get("pieceIdentite"),
            "dateInscription": M.maintenant(),
            "actif": True,
        }
    )
    d["compteurs"] = {**d["compteurs"], "client": ordre_client}
    d["compteursOrdreZone"] = {**d.get("compteursOrdreZone", {}), zone_id: ordre_zone}
    return (None, d, {"id": cid})


def modifier_client(d, u, p):
    if _est_caissier(u):
        return {"erreur": "Un caissier ne peut pas modifier un client."}
    id_ = p["id"]
    patch = p.get("patch") or {}
    d = copy.deepcopy(d)
    d["clients"] = [{**c, **patch} if c["id"] == id_ else c for c in d["clients"]]
    return (None, d, {})


def basculer_actif_client(d, u, p):
    id_ = p["id"]
    d = copy.deepcopy(d)
    d["clients"] = [{**c, "actif": not c["actif"]} if c["id"] == id_ else c for c in d["clients"]]
    return d


def supprimer_client(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Seul l'administrateur peut supprimer un client."}
    id_ = p["id"]
    client = next((c for c in d["clients"] if c["id"] == id_), None)
    if not client:
        return {"erreur": "Client introuvable."}
    if any(c["clientId"] == id_ for c in d["carnets"]):
        return {"erreur": "Impossible de supprimer : le client a des carnets tontine."}
    if any(c["clientId"] == id_ for c in d["comptes"]):
        return {"erreur": "Impossible de supprimer : le client a des comptes."}
    if any(c["clientId"] == id_ for c in d["credits"]):
        return {"erreur": "Impossible de supprimer : le client a des crédits."}
    if any(
        x.get("clientId") == id_ and x.get("statut") == "en_attente"
        for x in d.get("demandesOuvertureCompte") or []
    ):
        return {"erreur": "Impossible de supprimer : une demande d'ouverture de compte est en attente."}
    d = copy.deepcopy(d)
    d["clients"] = [c for c in d["clients"] if c["id"] != id_]
    d["demandesOuvertureCompte"] = [
        x for x in (d.get("demandesOuvertureCompte") or []) if x.get("clientId") != id_
    ]
    return (None, d, {})


def ouvrir_carnet(d, u, p):
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    client_id = p["clientId"]
    type_carnet = p.get("typeCarnet", "tontine")
    mise = float(p["mise"])
    frequence = p.get("frequence", "journaliere")
    if mise <= 0:
        return {"erreur": "Mise invalide."}
    client = next((c for c in d["clients"] if c["id"] == client_id), None)
    if not client:
        return {"erreur": "Client introuvable."}
    zone = next((z for z in d["zones"] if z["id"] == client["zoneId"]), None)
    if not zone:
        return {"erreur": "Zone introuvable."}
    d = copy.deepcopy(d)
    numeros = {c["numero"] for c in d["carnets"]}
    ordre = client["ordreZone"]
    numero = numero_carnet(zone["code"], ordre)
    while numero in numeros:
        ordre += 1
        numero = numero_carnet(zone["code"], ordre)
    cid = uid()
    date = M.maintenant()
    tx = _mk_tx(
        u,
        {
            "type": "vente_carnet",
            "clientId": client_id,
            "montant": M.PRIX_CARNET,
            "date": date,
            "description": f"Vente du carnet {numero} — {_nom_client(d, client_id)} (cycle 1/12)",
        },
    )
    d["carnets"].append(
        {
            "id": cid,
            "clientId": client_id,
            "numero": numero,
            "zoneId": zone["id"],
            "agenceId": zone["agenceId"],
            "typeCarnet": type_carnet,
            "mise": mise,
            "frequence": frequence,
            "misesParCycle": M.CARREAUX_PAR_CYCLE,
            "cycleActuel": 1,
            "dateOuverture": date,
            "verrouille": False,
            "retraitActiveParAdmin": type_carnet not in M.CARNETS_RETRAIT_6_MOIS,
            "actif": True,
        }
    )
    d = _enregistrer_tx(d, [tx])
    return {"data": d, "id": cid, "numero": numero}


def encaisser_cotisation(d, u, p):
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    carnet_id = p["carnetId"]
    montant = float(p["montant"])
    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet or not carnet.get("actif"):
        return {"erreur": "Carnet introuvable."}
    if carnet.get("verrouille"):
        return {"erreur": "Ce carnet est verrouille."}

    # avance cycles complets
    while carnet["cycleActuel"] < M.CYCLES_PAR_CARNET and M.carreaux_nets(carnet, d["mises"]) >= carnet["misesParCycle"]:
        carnet = {**carnet, "cycleActuel": carnet["cycleActuel"] + 1}
        d["carnets"] = [carnet if c["id"] == carnet_id else c for c in d["carnets"]]

    jour = M.aujourd_hui_iso()
    jz = M.journee_zone_du_jour(d["journeesCompteZone"], carnet["zoneId"], jour)
    if not jz or jz.get("cloturee"):
        zone = next((z for z in d["zones"] if z["id"] == carnet["zoneId"]), None)
        code = zone["code"] if zone else "—"
        if jz and jz.get("cloturee"):
            return {"erreur": f"La collecte tontine de la zone {code} est deja cloturee pour aujourd'hui."}
        return {
            "erreur": f"Saisissez d'abord le montant reel collecté pour la zone {code} avant les depots."
        }

    calc = M.calculer_mises_depuis_montant(montant, carnet["mise"])
    if not calc.get("ok"):
        return {"erreur": calc["erreur"]}
    payees = M.carreaux_nets(carnet, d["mises"])
    restants = carnet["misesParCycle"] - payees
    nombre = min(calc["nombreMises"], restants)
    if nombre <= 0:
        return {"erreur": "Le cycle actuel est deja complet (31 carreaux)."}
    if nombre != calc["nombreMises"]:
        return {"erreur": f"Seulement {restants} carreau(x) restant(s) sur ce cycle."}

    date = M.maintenant()
    cycle_depot = carnet["cycleActuel"]
    mise_entree = {
        "id": uid(),
        "carnetId": carnet_id,
        "cycle": cycle_depot,
        "nombreMises": nombre,
        "montant": carnet["mise"] * nombre,
        "date": date,
    }
    nouvelles = []
    if payees == 0:
        nouvelles.append(
            _mk_tx(
                u,
                {
                    "type": "commission_tontine",
                    "clientId": carnet["clientId"],
                    "montant": carnet["mise"],
                    "date": date,
                    "description": f"Premiere cotisation (P.C) — {_nom_client(d, carnet['clientId'])} (cycle {cycle_depot})",
                },
            )
        )
        if nombre > 1:
            nouvelles.append(
                _mk_tx(
                    u,
                    {
                        "type": "mise_tontine",
                        "clientId": carnet["clientId"],
                        "montant": carnet["mise"] * (nombre - 1),
                        "date": date,
                        "description": f"Depot x{nombre - 1} — {_nom_client(d, carnet['clientId'])} (cycle {cycle_depot})",
                    },
                )
            )
    else:
        nouvelles.append(
            _mk_tx(
                u,
                {
                    "type": "mise_tontine",
                    "clientId": carnet["clientId"],
                    "montant": mise_entree["montant"],
                    "date": date,
                    "description": f"Depot x{nombre} — {_nom_client(d, carnet['clientId'])} (cycle {cycle_depot})",
                },
            )
        )

    d["mises"] = [*d["mises"], mise_entree]
    nets_apres = payees + nombre
    if nets_apres >= carnet["misesParCycle"] and carnet["cycleActuel"] < M.CYCLES_PAR_CARNET:
        d["carnets"] = [
            {**c, "cycleActuel": c["cycleActuel"] + 1} if c["id"] == carnet_id else c for c in d["carnets"]
        ]
    d = _enregistrer_tx(d, nouvelles)
    return (None, d, {})


def changer_mise_carnet(d, u, p):
    """Augmente la mise du cycle en cours ; le client complète l'écart sur les carreaux déjà déposés."""
    carnet_id = p["carnetId"]
    nouvelle = float(p.get("nouvelleMise") or 0)
    if nouvelle <= 0:
        return {"erreur": "Nouvelle mise invalide."}
    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet or not carnet.get("actif"):
        return {"erreur": "Carnet introuvable."}
    if carnet.get("verrouille"):
        return {"erreur": "Ce carnet est verrouille."}
    ancienne = float(carnet["mise"])
    if nouvelle == ancienne:
        return {"erreur": "La nouvelle mise est identique a la mise actuelle."}
    if nouvelle < ancienne:
        return {"erreur": "Seule une augmentation de mise est autorisee."}

    cycle = carnet["cycleActuel"]
    deposes = M.carreaux_deposes(carnet, d["mises"], cycle)
    complement = deposes * (nouvelle - ancienne)

    if complement > 0:
        err = _verif_caisse(d, u)
        if err:
            return {"erreur": err}
        jour = M.aujourd_hui_iso()
        jz = M.journee_zone_du_jour(d["journeesCompteZone"], carnet["zoneId"], jour)
        if not jz or jz.get("cloturee"):
            zone = next((z for z in d["zones"] if z["id"] == carnet["zoneId"]), None)
            code = zone["code"] if zone else "—"
            if jz and jz.get("cloturee"):
                return {"erreur": f"La collecte tontine de la zone {code} est deja cloturee pour aujourd'hui."}
            return {
                "erreur": f"Saisissez d'abord le montant reel collecté pour la zone {code} avant le complement."
            }

    date = M.maintenant()
    d["carnets"] = [{**c, "mise": nouvelle} if c["id"] == carnet_id else c for c in d["carnets"]]

    if complement > 0:
        d["mises"] = [
            *d["mises"],
            {
                "id": uid(),
                "carnetId": carnet_id,
                "cycle": cycle,
                "nombreMises": 0,
                "montant": complement,
                "date": date,
            },
        ]
        d = _enregistrer_tx(
            d,
            [
                _mk_tx(
                    u,
                    {
                        "type": "complement_mise",
                        "clientId": carnet["clientId"],
                        "montant": complement,
                        "date": date,
                        "description": (
                            f"Complement mise {int(ancienne)}→{int(nouvelle)} ×{deposes} carreaux "
                            f"— {_nom_client(d, carnet['clientId'])} (cycle {cycle})"
                        ),
                    },
                )
            ],
        )

    return (
        None,
        d,
        {
            "ancienneMise": ancienne,
            "nouvelleMise": nouvelle,
            "carreaux": deposes,
            "complement": complement,
            "cycle": cycle,
        },
    )


def retrait_cycle(d, u, p):
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    carnet_id = p["carnetId"]
    cycle = int(p["cycle"])
    nombre = int(p["nombreCarreaux"])
    if nombre <= 0:
        return {"erreur": "Nombre invalide."}
    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet:
        return {"erreur": "Carnet introuvable."}
    if carnet.get("verrouille"):
        return {"erreur": "Carnet verrouille."}
    elig = M.eligibilite_retrait_carnet(carnet, d["mises"])
    if not elig.get("autorise"):
        return {"erreur": "Retrait non autorise pour ce type de carnet."}
    nets = M.carreaux_nets(carnet, d["mises"], cycle)
    if nombre > nets:
        return {"erreur": "Pas assez de carreaux."}
    montant = carnet["mise"] * nombre
    err2 = _verif_solde_sortie(d, u, montant)
    if err2:
        return {"erreur": err2}
    date = M.maintenant()
    d["mises"].append(
        {
            "id": uid(),
            "carnetId": carnet_id,
            "cycle": cycle,
            "nombreMises": -nombre,
            "montant": -montant,
            "date": date,
        }
    )
    tx = _mk_tx(
        u,
        {
            "type": "retrait_tontine",
            "clientId": carnet["clientId"],
            "montant": montant,
            "date": date,
            "description": f"Retrait {carnet['numero']} x{nombre} — {_nom_client(d, carnet['clientId'])}",
        },
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {})


def basculer_verrou_carnet(d, u, p):
    if not _a_droit(u, "verrouiller_comptes") and not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    d = copy.deepcopy(d)
    d["carnets"] = [{**c, "verrouille": not c["verrouille"]} if c["id"] == id_ else c for c in d["carnets"]]
    return d


def basculer_retrait_carnet_admin(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Reserve a l'administrateur."}
    id_ = p["id"]
    carnet = next((c for c in d["carnets"] if c["id"] == id_), None)
    if not carnet:
        return {"erreur": "Carnet introuvable."}
    if carnet["typeCarnet"] not in M.CARNETS_RETRAIT_6_MOIS:
        return {"erreur": "Cette action concerne uniquement les cartes enfants et bloquee."}
    d = copy.deepcopy(d)
    d["carnets"] = [
        {**c, "retraitActiveParAdmin": not c["retraitActiveParAdmin"]} if c["id"] == id_ else c
        for c in d["carnets"]
    ]
    return (None, d, {})


def ouvrir_compte(d, u, p):
    """Admin / chef : crée une demande ; le caissier désigné valide ensuite."""
    if _est_caissier(u):
        return {"erreur": "Un caissier ne peut pas ouvrir un compte : validez les demandes qui vous sont assignées."}
    if not (_est_admin(u) or _est_chef(u)):
        return {"erreur": "Droit insuffisant."}
    client_id = p["clientId"]
    type_ = p.get("type", "courant")
    promotion = bool(p.get("promotion") or False)
    caissier_id = p.get("caissierId") or ""
    if not caissier_id:
        return {"erreur": "Indiquez la caisse (caissier) qui encaissera part sociale et droit d'adhésion."}

    from .config import settings

    part_sociale = float(settings.part_sociale_montant)
    droit = float(
        settings.droit_adhesion_promo_montant if promotion else settings.droit_adhesion_montant
    )
    client = next((c for c in d["clients"] if c["id"] == client_id), None)
    if not client:
        return {"erreur": "Client introuvable."}
    caissier = next((e for e in d["employes"] if e["id"] == caissier_id and e.get("actif")), None)
    if not caissier or not _employe_a_compte_caisse(caissier["role"]):
        return {"erreur": "Caissier / titulaire de caisse introuvable."}
    if _est_chef(u) and caissier["agenceId"] != u["agenceId"]:
        return {"erreur": "Le caissier doit appartenir à votre agence."}
    if _est_chef(u) and client["agenceId"] != u["agenceId"]:
        return {"erreur": "Client hors de votre agence."}

    # Une seule demande en attente par client+type
    if any(
        x.get("statut") == "en_attente"
        and x.get("clientId") == client_id
        and x.get("type") == type_
        for x in d.get("demandesOuvertureCompte") or []
    ):
        return {"erreur": "Une demande d'ouverture de ce type est déjà en attente pour ce client."}

    d = copy.deepcopy(d)
    if "demandesOuvertureCompte" not in d:
        d["demandesOuvertureCompte"] = []
    did = uid()
    d["demandesOuvertureCompte"].append(
        {
            "id": did,
            "clientId": client_id,
            "type": type_,
            "promotion": promotion,
            "partSociale": part_sociale,
            "droitAdhesion": droit,
            "caissierId": caissier_id,
            "demandeurId": u["id"],
            "demandeurNom": u.get("nomComplet") or u.get("identifiant") or "",
            "dateDemande": M.maintenant(),
            "statut": "en_attente",
            "dateTraitement": None,
            "compteId": None,
            "motifRefus": None,
        }
    )
    return {
        "data": d,
        "demandeId": did,
        "partSociale": part_sociale,
        "droitAdhesion": droit,
        "totalEncaisse": part_sociale + droit,
        "promotion": promotion,
        "enAttente": True,
    }


def _appliquer_ouverture_compte_validee(d, operateur, demande):
    """Crée le compte + encaissements sur la caisse de l'opérateur (caissier)."""
    client_id = demande["clientId"]
    type_ = demande["type"]
    promotion = bool(demande.get("promotion"))
    part_sociale = float(demande.get("partSociale") or 0)
    droit = float(demande.get("droitAdhesion") or 0)
    ordre = int(d["compteurs"].get("compte", 0)) + 1
    cid = uid()
    numero = numero_compte_solde(ordre)
    date = M.maintenant()
    d["compteurs"] = {**d["compteurs"], "compte": ordre}
    d["comptes"].append(
        {
            "id": cid,
            "clientId": client_id,
            "type": type_,
            "numero": numero,
            "solde": droit,
            "dateOuverture": date,
            "verrouille": False,
            "partSociale": part_sociale,
            "droitAdhesion": droit,
            "promotion": promotion,
        }
    )
    d["mouvements"].append(
        {
            "id": uid(),
            "compteId": cid,
            "type": "depot",
            "montant": droit,
            "date": date,
            "note": f"Droit d'adhésion{' (promo)' if promotion else ''}",
        }
    )
    txs = [
        _mk_tx(
            operateur,
            {
                "type": "part_sociale",
                "clientId": client_id,
                "montant": part_sociale,
                "date": date,
                "description": f"Part sociale ouverture {numero} ({type_}) — {_nom_client(d, client_id)}",
            },
        ),
        _mk_tx(
            operateur,
            {
                "type": "droit_adhesion",
                "clientId": client_id,
                "montant": droit,
                "date": date,
                "description": f"Droit d'adhésion{' promo' if promotion else ''} {numero} ({type_}) — {_nom_client(d, client_id)} (crédité sur le compte)",
            },
        ),
    ]
    d = _enregistrer_tx(d, txs)
    return d, cid, numero


def valider_ouverture_compte(d, u, p):
    """Caissier désigné : encaissement + création du compte."""
    demande_id = p.get("demandeId")
    d = copy.deepcopy(d)
    demandes = d.get("demandesOuvertureCompte") or []
    demande = next((x for x in demandes if x["id"] == demande_id), None)
    if not demande:
        return {"erreur": "Demande introuvable."}
    if demande.get("statut") != "en_attente":
        return {"erreur": "Cette demande a déjà été traitée."}
    if demande.get("caissierId") != u["id"] and not _est_admin(u):
        return {"erreur": "Cette demande est assignée à un autre caissier."}
    # L'encaissement se fait sur la caisse du caissier (même si admin valide à sa place, on exige la caisse du destinataire)
    caissier = next((e for e in d["employes"] if e["id"] == demande["caissierId"] and e.get("actif")), None)
    if not caissier:
        return {"erreur": "Caissier assigné introuvable."}
    err = M.message_blocage_caisse_journaliere(
        caissier["id"], d["transactions"], d["arretsCaisse"], d.get("ouverturesCaisse") or []
    )
    if err:
        return {"erreur": f"Caisse du caissier : {err}"}

    operateur = caissier if demande.get("caissierId") == caissier["id"] else caissier
    d, cid, numero = _appliquer_ouverture_compte_validee(d, operateur, demande)
    d["demandesOuvertureCompte"] = [
        {
            **x,
            "statut": "validee",
            "dateTraitement": M.maintenant(),
            "compteId": cid,
        }
        if x["id"] == demande_id
        else x
        for x in d["demandesOuvertureCompte"]
    ]
    return {
        "data": d,
        "id": cid,
        "numero": numero,
        "partSociale": demande.get("partSociale"),
        "droitAdhesion": demande.get("droitAdhesion"),
        "totalEncaisse": float(demande.get("partSociale") or 0) + float(demande.get("droitAdhesion") or 0),
    }


def refuser_ouverture_compte(d, u, p):
    demande_id = p.get("demandeId")
    motif = (p.get("motif") or "").strip()
    d = copy.deepcopy(d)
    demande = next((x for x in (d.get("demandesOuvertureCompte") or []) if x["id"] == demande_id), None)
    if not demande:
        return {"erreur": "Demande introuvable."}
    if demande.get("statut") != "en_attente":
        return {"erreur": "Cette demande a déjà été traitée."}
    if demande.get("caissierId") != u["id"] and not _est_admin(u) and demande.get("demandeurId") != u["id"]:
        return {"erreur": "Droit insuffisant pour refuser."}
    d["demandesOuvertureCompte"] = [
        {
            **x,
            "statut": "refusee",
            "dateTraitement": M.maintenant(),
            "motifRefus": motif or None,
        }
        if x["id"] == demande_id
        else x
        for x in d["demandesOuvertureCompte"]
    ]
    return (None, d, {})


def deposer_compte(d, u, p):
    montant = float(p["montant"])
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    compte_id = p["compteId"]
    note = p.get("note")
    d = copy.deepcopy(d)
    compte = next((c for c in d["comptes"] if c["id"] == compte_id), None)
    if not compte:
        return {"erreur": "Compte introuvable."}
    if compte.get("verrouille"):
        return {"erreur": "Ce compte est verrouille."}
    date = M.maintenant()
    d["comptes"] = [
        {**c, "solde": c["solde"] + montant} if c["id"] == compte_id else c for c in d["comptes"]
    ]
    d["mouvements"].append(
        {"id": uid(), "compteId": compte_id, "type": "depot", "montant": montant, "date": date, "note": note}
    )
    tx = _mk_tx(
        u,
        {
            "type": "depot_compte",
            "clientId": compte["clientId"],
            "montant": montant,
            "date": date,
            "description": f"Depot {compte['numero']} — {_nom_client(d, compte['clientId'])}"
            + (f" ({note})" if note else ""),
        },
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {})


def retirer_compte(d, u, p):
    montant = float(p["montant"])
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    compte_id = p["compteId"]
    note = p.get("note")
    d = copy.deepcopy(d)
    compte = next((c for c in d["comptes"] if c["id"] == compte_id), None)
    if not compte:
        return {"erreur": "Compte introuvable."}
    if compte.get("verrouille"):
        return {"erreur": "Ce compte est verrouille."}
    if compte["solde"] < montant:
        return {"erreur": "Solde insuffisant."}
    err2 = _verif_solde_sortie(d, u, montant)
    if err2:
        return {"erreur": err2}
    date = M.maintenant()
    d["comptes"] = [
        {**c, "solde": c["solde"] - montant} if c["id"] == compte_id else c for c in d["comptes"]
    ]
    d["mouvements"].append(
        {"id": uid(), "compteId": compte_id, "type": "retrait", "montant": montant, "date": date, "note": note}
    )
    tx = _mk_tx(
        u,
        {
            "type": "retrait_compte",
            "clientId": compte["clientId"],
            "montant": montant,
            "date": date,
            "description": f"Retrait {compte['numero']} — {_nom_client(d, compte['clientId'])}"
            + (f" ({note})" if note else ""),
        },
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {})


def basculer_verrou_compte(d, u, p):
    if not _a_droit(u, "verrouiller_comptes") and not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    d = copy.deepcopy(d)
    d["comptes"] = [{**c, "verrouille": not c["verrouille"]} if c["id"] == id_ else c for c in d["comptes"]]
    return d


def demander_credit(d, u, p):
    d = copy.deepcopy(d)
    numero = int(d["compteurs"].get("credit", 0)) + 1
    d["compteurs"] = {**d["compteurs"], "credit": numero}
    d["credits"].append(
        {
            "id": uid(),
            "numero": f"CR-{pad4(numero)}",
            "clientId": p["clientId"],
            "montant": float(p["montant"]),
            "tauxInteret": float(p.get("tauxInteret", 0)),
            "dureeMois": int(p.get("dureeMois", 1)),
            "motif": p.get("motif"),
            "dateDemande": M.maintenant(),
            "statut": "en_attente",
        }
    )
    return d


def approuver_credit(d, u, p):
    credit_id = p["creditId"]
    d = copy.deepcopy(d)
    credit = next((c for c in d["credits"] if c["id"] == credit_id), None)
    if not credit or credit["statut"] != "en_attente":
        return d
    err = _verif_solde_sortie(d, u, credit["montant"])
    if err:
        return {"erreur": err}
    date = M.maintenant()
    d["credits"] = [
        {**c, "statut": "en_cours", "dateOctroi": date} if c["id"] == credit_id else c for c in d["credits"]
    ]
    tx = _mk_tx(
        u,
        {
            "type": "octroi_credit",
            "clientId": credit["clientId"],
            "montant": credit["montant"],
            "date": date,
            "description": f"Octroi credit {credit['numero']} — {_nom_client(d, credit['clientId'])}",
        },
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {})


def rejeter_credit(d, u, p):
    credit_id = p["creditId"]
    d = copy.deepcopy(d)
    d["credits"] = [
        {**c, "statut": "rejete"} if c["id"] == credit_id and c["statut"] == "en_attente" else c
        for c in d["credits"]
    ]
    return d


def rembourser_credit(d, u, p):
    credit_id = p["creditId"]
    montant = float(p["montant"])
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    d = copy.deepcopy(d)
    credit = next((c for c in d["credits"] if c["id"] == credit_id), None)
    if not credit or credit["statut"] not in ("en_cours", "en_retard"):
        return {"erreur": "Credit introuvable."}
    date = M.maintenant()
    total_du = credit["montant"] * (1 + credit["tauxInteret"] / 100)
    deja = sum(r["montant"] for r in d["remboursements"] if r["creditId"] == credit_id)
    solde_apres = total_du - deja - montant
    d["remboursements"].append({"id": uid(), "creditId": credit_id, "montant": montant, "date": date})
    if solde_apres <= 0.5:
        d["credits"] = [{**c, "statut": "rembourse"} if c["id"] == credit_id else c for c in d["credits"]]
    tx = _mk_tx(
        u,
        {
            "type": "remboursement_credit",
            "clientId": credit["clientId"],
            "montant": montant,
            "date": date,
            "description": f"Remboursement {credit['numero']} — {_nom_client(d, credit['clientId'])}",
        },
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {})


def ajouter_employe(d, u, p):
    if not _est_admin(u) and not _a_droit(u, "gerer_employes"):
        return {"erreur": "Droit insuffisant."}
    if any(e["identifiant"] == p.get("identifiant") for e in d["employes"]):
        return {"erreur": "Identifiant deja utilise."}
    d = copy.deepcopy(d)
    nouvel = {
        "id": uid(),
        "nomComplet": p.get("nomComplet", ""),
        "identifiant": p.get("identifiant", ""),
        "motDePasse": p.get("motDePasse", "changeme"),
        "role": p.get("role", "caissier"),
        "agenceId": p.get("agenceId"),
        "droits": p.get("droits") or [],
        "telephone": p.get("telephone"),
        "email": p.get("email"),
        "adresse": p.get("adresse"),
        "pieceIdentite": p.get("pieceIdentite"),
        "dateEmbauche": M.maintenant(),
        "actif": True,
    }
    d["employes"].append(nouvel)
    if _employe_a_compte_caisse(nouvel["role"]):
        d = _ouvrir_compte_caisse_si_besoin(d, nouvel["id"])
    return (None, d, {})


def modifier_employe(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    patch = dict(p.get("patch") or {})
    d = copy.deepcopy(d)
    d["employes"] = [{**e, **patch} if e["id"] == id_ else e for e in d["employes"]]
    return d


def supprimer_employe(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    if id_ == u["id"]:
        return {"erreur": "Impossible de supprimer votre propre compte."}
    d = copy.deepcopy(d)
    d["employes"] = [e for e in d["employes"] if e["id"] != id_]
    return d


def basculer_actif_employe(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    d = copy.deepcopy(d)
    d["employes"] = [{**e, "actif": not e["actif"]} if e["id"] == id_ else e for e in d["employes"]]
    return d


def alimenter_compte_caisse(d, u, p):
    if not _est_admin(u) and not _est_chef(u):
        return {"erreur": "Seul l'administrateur ou le chef d'agence peut alimenter un compte caisse."}
    employe_id = p["employeId"]
    montant = float(p["montant"])
    note = p.get("note")
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    cible = next((e for e in d["employes"] if e["id"] == employe_id and e.get("actif")), None)
    if not cible:
        return {"erreur": "Employe introuvable."}
    if not _employe_a_compte_caisse(cible["role"]):
        return {"erreur": "Cet employe n'a pas de compte caisse."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez alimenter que les caisses de votre agence."}
    d = _ouvrir_compte_caisse_si_besoin(copy.deepcopy(d), cible["id"])
    compte = M.compte_caisse_de(d["comptesCaisse"], cible["id"])
    if not compte:
        return {"erreur": "Compte caisse introuvable."}
    date = M.maintenant()
    solde_apres = compte["solde"] + montant
    mouvement = {
        "id": uid(),
        "compteCaisseId": compte["id"],
        "employeId": cible["id"],
        "type": "alimentation",
        "montant": montant,
        "sens": "credit",
        "soldeApres": solde_apres,
        "date": date,
        "description": f"Alimentation — {note.strip()}" if note and note.strip() else f"Alimentation du compte caisse {compte['numero']}",
        "operateurId": u["id"],
        "operateurNom": u["nomComplet"],
    }
    d["comptesCaisse"] = [
        {**c, "solde": solde_apres} if c["id"] == compte["id"] else c for c in d["comptesCaisse"]
    ]
    d["mouvementsCompteCaisse"] = [mouvement, *d["mouvementsCompteCaisse"]]
    return (None, d, {})


def ouvrir_journee_caisse(d, u, p):
    if not _est_admin(u) and not _est_chef(u):
        return {"erreur": "Seul l'administrateur ou le chef d'agence peut ouvrir une journee de caisse."}
    employe_id = p["employeId"]
    solde_ouverture = float(p["soldeOuverture"])
    note = p.get("note")
    jour = p.get("journee") or M.aujourd_hui_iso()
    if solde_ouverture < 0:
        return {"erreur": "Montant d'ouverture invalide."}
    cible = next((e for e in d["employes"] if e["id"] == employe_id and e.get("actif")), None)
    if not cible:
        return {"erreur": "Employe introuvable."}
    if not _employe_a_compte_caisse(cible["role"]):
        return {"erreur": "Cet employe n'a pas de compte caisse."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez ouvrir que les caisses de votre agence."}
    d = copy.deepcopy(d)
    if M.ouverture_caisse_du_jour(d.get("ouverturesCaisse") or [], cible["id"], jour):
        return {"erreur": f"La journee du {jour} est deja ouverte."}
    if M.arret_caisse_du_jour(d["arretsCaisse"], cible["id"], jour):
        return {"erreur": f"La journee du {jour} est deja cloturee."}
    en_attente = M.journees_ouvertes_en_attente_cloture(
        cible["id"], d.get("ouverturesCaisse") or [], d["arretsCaisse"], jour
    )
    if en_attente:
        return {"erreur": f"Impossible d'ouvrir le {jour} : la journee du {en_attente[0]} est en attente de cloture."}
    retards = M.journees_caisse_en_retard(
        cible["id"], d["transactions"], d["arretsCaisse"], d.get("ouverturesCaisse") or [], jour
    )
    if retards and jour != retards[0]:
        return {"erreur": f"Cloturez d'abord la journee du {retards[0]} avant d'ouvrir le {jour}."}
    if not retards and jour != M.aujourd_hui_iso():
        return {"erreur": "Seule la journee en cours (ou une journee en retard) peut etre ouverte."}
    date = M.maintenant()
    ouverture = {
        "id": uid(),
        "employeId": cible["id"],
        "employeNom": cible["nomComplet"],
        "agenceId": cible["agenceId"],
        "journee": jour,
        "soldeOuverture": solde_ouverture,
        "dateOuverture": date,
        "ouvertParId": u["id"],
        "ouvertParNom": u["nomComplet"],
        "note": (note or "").strip() or None,
    }
    d["ouverturesCaisse"] = [ouverture, *(d.get("ouverturesCaisse") or [])]
    d = _ouvrir_compte_caisse_si_besoin(d, cible["id"])
    compte = M.compte_caisse_de(d["comptesCaisse"], cible["id"])
    if compte and compte["solde"] != solde_ouverture:
        delta = solde_ouverture - compte["solde"]
        mouvement = {
            "id": uid(),
            "compteCaisseId": compte["id"],
            "employeId": cible["id"],
            "type": "ouverture_journee",
            "montant": abs(delta),
            "sens": "credit" if delta >= 0 else "debit",
            "soldeApres": solde_ouverture,
            "date": date,
            "description": f"Ouverture de caisse — solde saisi {solde_ouverture} FCFA",
            "operateurId": u["id"],
            "operateurNom": u["nomComplet"],
        }
        d["comptesCaisse"] = [
            {**c, "solde": solde_ouverture} if c["id"] == compte["id"] else c for c in d["comptesCaisse"]
        ]
        d["mouvementsCompteCaisse"] = [mouvement, *d["mouvementsCompteCaisse"]]
    return (None, d, {})


def arreter_caisse(d, u, p):
    if not _est_admin(u) and not _est_chef(u):
        return {"erreur": "Seul l'administrateur ou le chef d'agence peut effectuer un arret de caisse."}
    montant = float(p["montantFermeture"])
    note = p.get("note")
    cible_id = p.get("cibleEmployeId")
    jour = p.get("journee") or M.aujourd_hui_iso()
    if montant < 0:
        return {"erreur": "Montant de fermeture invalide."}
    if not cible_id:
        return {"erreur": "Caissier non precise."}
    cible = next((e for e in d["employes"] if e["id"] == cible_id and e.get("actif")), None)
    if not cible:
        return {"erreur": "Employe introuvable."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez arreter que les caisses de votre agence."}
    d = copy.deepcopy(d)
    if M.arret_caisse_du_jour(d["arretsCaisse"], cible["id"], jour):
        return {"erreur": f"La caisse du {jour} est deja arretee."}
    ouverture = M.ouverture_caisse_du_jour(d.get("ouverturesCaisse") or [], cible["id"], jour)
    if not ouverture:
        return {"erreur": f"Ouvrez d'abord la journee du {jour}."}
    retards = M.journees_caisse_en_retard(
        cible["id"], d["transactions"], d["arretsCaisse"], d.get("ouverturesCaisse") or []
    )
    if retards and jour != retards[0]:
        return {"erreur": f"Cloturez d'abord la journee du {retards[0]}."}
    if not retards and jour != M.aujourd_hui_iso():
        return {"erreur": "Seule la journee en cours (ou une journee en retard) peut etre arretee."}
    sit = M.situation_caisse(
        cible["id"],
        d["transactions"],
        d["arretsCaisse"],
        jour,
        d["comptesCaisse"],
        d["mouvementsCompteCaisse"],
        d.get("ouverturesCaisse") or [],
    )
    dates = sorted(t["date"] for t in sit["transactions"])
    now = M.maintenant()
    solde_th = sit["soldeFermetureTheorique"]
    ecart = montant - solde_th
    arret = {
        "id": uid(),
        "employeId": cible["id"],
        "employeNom": cible["nomComplet"],
        "agenceId": cible["agenceId"],
        "journee": jour,
        "dateCloture": now,
        "date": now,
        "debutPeriode": dates[0] if dates else ouverture["dateOuverture"],
        "nombreOperations": sit["nombreOperations"],
        "totalEntrees": sit["totalEntrees"],
        "totalSorties": sit["totalSorties"],
        "soldeOuverture": ouverture["soldeOuverture"],
        "soldeTheorique": solde_th,
        "montantCompte": montant,
        "ecart": ecart,
        "note": note,
        "valideParId": u["id"],
        "valideParNom": u["nomComplet"],
    }
    d["arretsCaisse"] = [arret, *d["arretsCaisse"]]
    d = _ouvrir_compte_caisse_si_besoin(d, cible["id"])
    compte = M.compte_caisse_de(d["comptesCaisse"], cible["id"])
    if compte:
        cm = compte.get("cumulManquant", 0)
        cs = compte.get("cumulSurplus", 0)
        if ecart < 0:
            cm += abs(ecart)
        if ecart > 0:
            cs += ecart
        mouvements = d["mouvementsCompteCaisse"]
        solde = compte["solde"]
        if ecart != 0 and compte["solde"] != montant:
            solde = montant
            mouvements = [
                {
                    "id": uid(),
                    "compteCaisseId": compte["id"],
                    "employeId": cible["id"],
                    "type": "ajustement_arret",
                    "montant": abs(ecart),
                    "sens": "credit" if ecart > 0 else "debit",
                    "soldeApres": solde,
                    "date": now,
                    "description": (
                        f"Ajustement de fermeture — surplus {abs(ecart)} FCFA"
                        if ecart > 0
                        else f"Ajustement de fermeture — manquant {abs(ecart)} FCFA"
                    ),
                    "operateurId": u["id"],
                    "operateurNom": u["nomComplet"],
                },
                *mouvements,
            ]
        d["comptesCaisse"] = [
            {**c, "solde": solde, "cumulManquant": cm, "cumulSurplus": cs} if c["id"] == compte["id"] else c
            for c in d["comptesCaisse"]
        ]
        d["mouvementsCompteCaisse"] = mouvements
    return (None, d, {})


def regulariser_cumul_compte_caisse(d, u, p):
    if not _est_admin(u):
        return {"erreur": "Reserve a l'administrateur."}
    employe_id = p["employeId"]
    type_ = p["type"]
    montant = float(p["montant"])
    motif = (p.get("motif") or "").strip()
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    if not motif:
        return {"erreur": "Motif obligatoire."}
    d = copy.deepcopy(d)
    compte = M.compte_caisse_de(d["comptesCaisse"], employe_id)
    if not compte:
        return {"erreur": "Compte caisse introuvable."}
    avant = compte["cumulManquant"] if type_ == "manquant" else compte["cumulSurplus"]
    if montant > avant:
        return {"erreur": "Montant superieur au cumul."}
    apres = avant - montant
    d["comptesCaisse"] = [
        {
            **c,
            "cumulManquant": apres if type_ == "manquant" else c["cumulManquant"],
            "cumulSurplus": apres if type_ == "surplus" else c["cumulSurplus"],
        }
        if c["id"] == compte["id"]
        else c
        for c in d["comptesCaisse"]
    ]
    d["ajustementsCompteCaisse"] = [
        {
            "id": uid(),
            "compteCaisseId": compte["id"],
            "employeId": employe_id,
            "date": M.maintenant(),
            "type": type_,
            "montant": montant,
            "motif": motif,
            "adminId": u["id"],
            "adminNom": u["nomComplet"],
            "cumulAvant": avant,
            "cumulApres": apres,
        },
        *d["ajustementsCompteCaisse"],
    ]
    return (None, d, {})


ACTIONS = {
    "ajouterAgence": ajouter_agence,
    "modifierAgence": modifier_agence,
    "basculerActifAgence": basculer_actif_agence,
    "ajouterZone": ajouter_zone,
    "modifierZone": modifier_zone,
    "basculerActifZone": basculer_actif_zone,
    "saisirMontantReelZone": saisir_montant_reel_zone,
    "cloturerJourneeZone": cloturer_journee_zone,
    "ajusterCumulCompteZone": ajuster_cumul_compte_zone,
    "ajouterClient": ajouter_client,
    "modifierClient": modifier_client,
    "basculerActifClient": basculer_actif_client,
    "supprimerClient": supprimer_client,
    "ouvrirCarnet": ouvrir_carnet,
    "encaisserCotisation": encaisser_cotisation,
    "changerMiseCarnet": changer_mise_carnet,
    "retraitCycle": retrait_cycle,
    "basculerVerrouCarnet": basculer_verrou_carnet,
    "basculerRetraitCarnetAdmin": basculer_retrait_carnet_admin,
    "ouvrirCompte": ouvrir_compte,
    "validerOuvertureCompte": valider_ouverture_compte,
    "refuserOuvertureCompte": refuser_ouverture_compte,
    "deposerCompte": deposer_compte,
    "retirerCompte": retirer_compte,
    "basculerVerrouCompte": basculer_verrou_compte,
    "demanderCredit": demander_credit,
    "approuverCredit": approuver_credit,
    "rejeterCredit": rejeter_credit,
    "rembourserCredit": rembourser_credit,
    "ajouterEmploye": ajouter_employe,
    "modifierEmploye": modifier_employe,
    "supprimerEmploye": supprimer_employe,
    "basculerActifEmploye": basculer_actif_employe,
    "alimenterCompteCaisse": alimenter_compte_caisse,
    "ouvrirJourneeCaisse": ouvrir_journee_caisse,
    "arreterCaisse": arreter_caisse,
    "regulariserCumulCompteCaisse": regulariser_cumul_compte_caisse,
    "reinitialiserDemo": lambda d, u, p: {"erreur": "handled upstream"},
}
