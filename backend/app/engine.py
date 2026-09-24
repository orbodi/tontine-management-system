"""Moteur métier — mutations AppData (port de src/store.tsx)."""
from __future__ import annotations

import copy
import math
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


def est_numero_zzxxxx(code: str | None, code_zone: str) -> bool:
    """True si le n° stocké est déjà {zone 2 chiffres}{rang 4 chiffres}."""
    digits = re.sub(r"\D", "", code or "")
    return len(digits) == 6 and digits[:2] == pad2(code_zone)


def numeros_clients_carnets_obsoletes(d: dict) -> bool:
    """True s'il reste des n° clients/carnets au format d'avant ZZxxxx."""
    zones = {z["id"]: z for z in d.get("zones") or []}
    par_client = {c["id"]: c for c in d.get("clients") or []}
    for c in d.get("clients") or []:
        zone = zones.get(c.get("zoneId") or "")
        if not zone:
            continue
        if not est_numero_zzxxxx(c.get("codeClient"), zone["code"]):
            return True
        attendu = numero_carnet(zone["code"], int(c.get("ordreZone") or 0))
        if c.get("codeClient") != attendu:
            return True
    vus: set[tuple[str, str]] = set()
    for ca in d.get("carnets") or []:
        client = par_client.get(ca.get("clientId") or "")
        if not client:
            continue
        zone = zones.get(client.get("zoneId") or "")
        if not zone:
            continue
        cle = (ca.get("clientId") or "", ca.get("typeCarnet") or "")
        if cle in vus:
            continue
        vus.add(cle)
        if ca.get("numero") != client.get("codeClient"):
            return True
        if ca.get("zoneId") != zone["id"] or ca.get("agenceId") != zone["agenceId"]:
            return True
    return False


def suffixe_ordre_numero(code: str | None) -> int:
    """Partie locale d'un numéro ZZxxxx (les 4 derniers chiffres)."""
    digits = re.sub(r"\D", "", code or "")
    if len(digits) >= 4:
        return int(digits[-4:])
    if digits:
        return int(digits)
    return 0


def _max_ordre_zone(d: dict, zone_id: str, *, exclude_id: str | None = None) -> int:
    """Plus grand ordre local actuellement occupé dans la zone (clients + carnets)."""
    existants: list[int] = []
    for c in d.get("clients") or []:
        if c.get("zoneId") != zone_id or c.get("id") == exclude_id:
            continue
        existants.append(int(c.get("ordreZone") or 0))
        existants.append(suffixe_ordre_numero(c.get("codeClient")))
    for ca in d.get("carnets") or []:
        if ca.get("zoneId") != zone_id or ca.get("clientId") == exclude_id:
            continue
        existants.append(suffixe_ordre_numero(ca.get("numero")))
    return max(existants, default=0)


def _prochain_ordre_zone(
    d: dict,
    zone_id: str,
    *,
    exclude_id: str | None = None,
    code_zone: str | None = None,
) -> int:
    """Prochain rang libre : max des occupants + 1, en évitant un n° déjà attribué."""
    n = _max_ordre_zone(d, zone_id, exclude_id=exclude_id) + 1
    if not code_zone:
        return n
    occupes = {
        c.get("codeClient")
        for c in d.get("clients") or []
        if c.get("id") != exclude_id and c.get("codeClient")
    }
    occupes.update(
        ca.get("numero")
        for ca in d.get("carnets") or []
        if ca.get("clientId") != exclude_id and ca.get("numero")
    )
    while numero_carnet(code_zone, n) in occupes:
        n += 1
    return n


def numero_client(ordre: int) -> str:
    return pad4(ordre)


def numero_client_banque(ordre: int) -> str:
    """N° client banque : 0001, 0002… (indépendant du n° tontine ZZxxxx)."""
    return pad4(ordre)


def _ordres_banque_occupes(d: dict, *, exclude_id: str | None = None) -> set[int]:
    occupes: set[int] = set()
    for c in d.get("clients") or []:
        if c.get("id") == exclude_id:
            continue
        n = int(c.get("ordreBanque") or 0)
        if n > 0:
            occupes.add(n)
        code = re.sub(r"\D", "", c.get("codeClientBanque") or "")
        if code:
            occupes.add(int(code))
    return occupes


def _prochain_ordre_banque(d: dict, *, exclude_id: str | None = None) -> int:
    """Plus petit n° banque libre (réutilise 0001 si plus personne ne l’a)."""
    occupes = _ordres_banque_occupes(d, exclude_id=exclude_id)
    n = 1
    while n in occupes:
        n += 1
    return n


def _ordres_compte_solde_occupes(d: dict) -> set[int]:
    occupes: set[int] = set()
    for c in d.get("comptes") or []:
        m = re.fullmatch(r"B(\d+)", (c.get("numero") or "").strip(), re.IGNORECASE)
        if m:
            occupes.add(int(m.group(1)))
    return occupes


def _prochain_ordre_compte_solde(d: dict) -> int:
    """Plus petit n° de compte Bxxxx libre (réutilise B0001 si le compte a été supprimé)."""
    occupes = _ordres_compte_solde_occupes(d)
    n = 1
    while n in occupes:
        n += 1
    return n


def _sync_compteur_client_banque(d: dict) -> None:
    n = max(_ordres_banque_occupes(d), default=0)
    d["compteurs"] = {**(d.get("compteurs") or {}), "clientBanque": n}


def attribuer_numeros_clients_banque(d: dict) -> bool:
    """Assigne un n° banque aux clients qui ont un compte et pas encore de codeClientBanque."""
    ids_compte = {co.get("clientId") for co in d.get("comptes") or [] if co.get("clientId")}
    if not ids_compte:
        avant = int((d.get("compteurs") or {}).get("clientBanque") or 0)
        _sync_compteur_client_banque(d)
        return int((d.get("compteurs") or {}).get("clientBanque") or 0) != avant
    premiere_date: dict[str, str] = {}
    for co in d.get("comptes") or []:
        cid = co.get("clientId")
        if not cid:
            continue
        dt = co.get("dateOuverture") or ""
        if cid not in premiere_date or dt < premiere_date[cid]:
            premiere_date[cid] = dt
    par_id = {c["id"]: c for c in d.get("clients") or []}
    a_numeroter = [
        par_id[cid]
        for cid in sorted(ids_compte, key=lambda i: (premiere_date.get(i) or "", i))
        if cid in par_id and not par_id[cid].get("codeClientBanque")
    ]
    if not a_numeroter:
        avant = int((d.get("compteurs") or {}).get("clientBanque") or 0)
        _sync_compteur_client_banque(d)
        return int((d.get("compteurs") or {}).get("clientBanque") or 0) != avant
    for c in a_numeroter:
        n = _prochain_ordre_banque(d)
        par_id[c["id"]] = {
            **c,
            "ordreBanque": n,
            "codeClientBanque": numero_client_banque(n),
        }
        d["clients"] = [par_id.get(x["id"], x) for x in d["clients"]]
    _sync_compteur_client_banque(d)
    return True


def attribuer_numeros_clients_banque_persist(db: Session) -> None:
    d = load_state(db, include_password_hashes=True)
    if attribuer_numeros_clients_banque(d):
        _persist(db, d)


def _assurer_numero_client_banque(d: dict, client_id: str) -> None:
    """Attribue le plus petit n° banque libre (0001 si plus aucun client banque)."""
    client = next((c for c in d.get("clients") or [] if c["id"] == client_id), None)
    if not client or client.get("codeClientBanque"):
        return
    n = _prochain_ordre_banque(d, exclude_id=client_id)
    d["clients"] = [
        {**c, "ordreBanque": n, "codeClientBanque": numero_client_banque(n)} if c["id"] == client_id else c
        for c in d["clients"]
    ]
    _sync_compteur_client_banque(d)


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


def _realigner_numeros_clients_carnets(d: dict) -> bool:
    """Aligne codeClient = {zone}{ordre} et tous les carnets du client sur ce numéro.

    Ancien format (ex. ``0001``) : on renumérote 1..n dans chaque zone, puis on préfixe.
    Format ZZxxxx déjà en place : on conserve les rangs (y compris les trous).
    """
    zones = {z["id"]: z for z in d.get("zones") or []}
    clients = list(d.get("clients") or [])
    par_zone: dict[str, list[int]] = {}
    for i, c in enumerate(clients):
        par_zone.setdefault(c.get("zoneId") or "", []).append(i)

    changed = False
    for zone_id, indices in par_zone.items():
        zone = zones.get(zone_id)
        if not zone:
            continue
        ordres = [int(clients[i].get("ordreZone") or 0) for i in indices]
        ancien_format = any(
            not est_numero_zzxxxx(clients[i].get("codeClient"), zone["code"]) for i in indices
        )
        if ancien_format or len(ordres) != len(set(ordres)) or any(o <= 0 for o in ordres):
            indices_tries = sorted(
                indices,
                key=lambda i: (
                    suffixe_ordre_numero(clients[i].get("codeClient")),
                    int(clients[i].get("ordreZone") or 0),
                    clients[i].get("dateInscription") or "",
                    clients[i].get("id") or "",
                ),
            )
            for n, i in enumerate(indices_tries, 1):
                if int(clients[i].get("ordreZone") or 0) != n:
                    changed = True
                clients[i] = {**clients[i], "ordreZone": n}
        for i in indices:
            c = clients[i]
            attendu = numero_carnet(zone["code"], int(c.get("ordreZone") or 0))
            if c.get("codeClient") != attendu:
                changed = True
                clients[i] = {**c, "codeClient": attendu}

    carnets, carnets_changed = _aligner_carnets_sur_clients(d.get("carnets") or [], clients, zones)
    changed = changed or carnets_changed

    if not changed:
        return False
    d["clients"] = clients
    d["carnets"] = carnets
    compteurs = dict(d.get("compteursOrdreZone") or {})
    for zone_id in par_zone:
        if zone_id:
            compteurs[zone_id] = _max_ordre_zone(d, zone_id)
    d["compteursOrdreZone"] = compteurs
    return True


def _aligner_carnets_sur_clients(
    carnets_src: list[dict],
    clients: list[dict],
    zones: dict[str, dict],
) -> tuple[list[dict], bool]:
    """Un numéro partagé par type ( = codeClient ) ; les doublons de type gardent un numéro libre."""
    par_client = {c["id"]: c for c in clients}
    primaires: list[dict] = []
    extras: list[dict] = []
    vus: set[tuple[str, str]] = set()
    for ca in sorted(
        carnets_src,
        key=lambda x: (
            0 if (par_client.get(x.get("clientId") or "") or {}).get("codeClient") == x.get("numero") else 1,
            x.get("dateOuverture") or "",
            x.get("id") or "",
        ),
    ):
        cle = (ca.get("clientId") or "", ca.get("typeCarnet") or "")
        if cle in vus:
            extras.append(ca)
        else:
            vus.add(cle)
            primaires.append(ca)

    occupes: set[tuple[str, str]] = set()
    par_id: dict[str, dict] = {}
    changed = False

    def _appliquer(ca: dict, numero: str, zone: dict | None) -> None:
        nonlocal changed
        patch: dict[str, Any] = {}
        if ca.get("numero") != numero:
            patch["numero"] = numero
        if zone and (ca.get("zoneId") != zone["id"] or ca.get("agenceId") != zone["agenceId"]):
            patch["zoneId"] = zone["id"]
            patch["agenceId"] = zone["agenceId"]
        occupes.add((numero, ca.get("typeCarnet") or ""))
        if patch:
            changed = True
            par_id[ca["id"]] = {**ca, **patch}
        else:
            par_id[ca["id"]] = ca

    for ca in primaires:
        client = par_client.get(ca.get("clientId") or "")
        if not client:
            occupes.add((ca.get("numero") or "", ca.get("typeCarnet") or ""))
            par_id[ca["id"]] = ca
            continue
        zone = zones.get(client.get("zoneId") or "")
        _appliquer(ca, client["codeClient"], zone)

    for ca in extras:
        client = par_client.get(ca.get("clientId") or "")
        zone = zones.get((client or {}).get("zoneId") or "") if client else None
        typ = ca.get("typeCarnet") or ""
        actuel = ca.get("numero") or ""
        prefixe = pad2((zone or {}).get("code") or "00")
        codes_zone = {
            c.get("codeClient") or ""
            for c in clients
            if zone and c.get("zoneId") == zone["id"] and c.get("codeClient")
        }
        # Doublon : garder le numéro seulement s'il est déjà préfixé de la zone
        # et n'est le n° client de personne (sinon collision à l'ouverture d'un carnet).
        if (
            actuel.startswith(prefixe)
            and actuel
            and (actuel, typ) not in occupes
            and actuel not in codes_zone
        ):
            _appliquer(ca, actuel, zone)
            continue
        n = 1
        code_zone = (zone or {}).get("code") or "00"
        while True:
            cand = numero_carnet(code_zone, n)
            if (cand, typ) not in occupes and cand not in codes_zone:
                break
            n += 1
        _appliquer(ca, cand, zone)

    return [par_id.get(ca["id"], ca) for ca in carnets_src], changed


def realigner_numeros_persist(db: Session) -> None:
    d = load_state(db, include_password_hashes=True)
    if not d.get("clients") and not d.get("carnets"):
        return
    if _realigner_numeros_clients_carnets(d):
        _persist(db, d)


def consolider_caisses_par_agence(d: dict) -> bool:
    """Une caisse active par agence ; le chef d'agence n'en a pas.

    Fusionne les comptes surnuméraires (mouvements, cumuls) dans le compte du caissier.
    Retourne True si l'état a changé.
    """
    changed = False
    par_agence: dict[str, list[dict]] = {}
    for c in d.get("comptesCaisse") or []:
        if not c.get("actif"):
            continue
        par_agence.setdefault(c.get("agenceId") or "", []).append(c)

    for agence_id, comptes in par_agence.items():
        if not agence_id:
            continue
        caissier = _premier_caissier_agence(d, agence_id)

        def _score(c: dict) -> tuple:
            emp = next((e for e in d["employes"] if e["id"] == c.get("employeId")), None)
            return (1 if emp and emp.get("role") == "caissier" else 0, abs(float(c.get("solde") or 0)))

        comptes.sort(key=_score, reverse=True)
        keeper = comptes[0]
        agence_changed = False
        emp_k = next((e for e in d["employes"] if e["id"] == keeper.get("employeId")), None)
        if emp_k and emp_k.get("role") == "chef_agence" and caissier:
            keeper["employeId"] = caissier["id"]
            agence_changed = True
        elif caissier and keeper.get("employeId") != caissier["id"] and len(comptes) == 1:
            keeper["employeId"] = caissier["id"]
            agence_changed = True

        for extra in comptes[1:]:
            agence_changed = True
            extra_id = extra["id"]
            keeper["cumulManquant"] = float(keeper.get("cumulManquant") or 0) + float(
                extra.get("cumulManquant") or 0
            )
            keeper["cumulSurplus"] = float(keeper.get("cumulSurplus") or 0) + float(
                extra.get("cumulSurplus") or 0
            )
            d["mouvementsCompteCaisse"] = [
                {**m, "compteCaisseId": keeper["id"]} if m.get("compteCaisseId") == extra_id else m
                for m in (d.get("mouvementsCompteCaisse") or [])
            ]
            d["ajustementsCompteCaisse"] = [
                {**a, "compteCaisseId": keeper["id"]} if a.get("compteCaisseId") == extra_id else a
                for a in (d.get("ajustementsCompteCaisse") or [])
            ]
            extra["actif"] = False

        if agence_changed:
            changed = True
            _recalculer_solde_compte_caisse(d, keeper["employeId"], 0.0)

    tx_ids = {t["id"] for t in d.get("transactions") or []}
    mvts = d.get("mouvementsCompteCaisse") or []
    propres = [
        m for m in mvts if not (m.get("transactionId") and m.get("transactionId") not in tx_ids)
    ]
    if len(propres) != len(mvts):
        d["mouvementsCompteCaisse"] = propres
        changed = True
    for c in d.get("comptesCaisse") or []:
        if not c.get("actif") or not c.get("employeId"):
            continue
        avant = float(c.get("solde") or 0)
        d = _recalculer_solde_compte_caisse(d, c["employeId"], 0.0)
        apres = next((x for x in d["comptesCaisse"] if x["id"] == c["id"]), None)
        if apres and abs(float(apres.get("solde") or 0) - avant) > 0.005:
            changed = True

    return changed


def consolider_caisses_agence_persist(db: Session) -> None:
    d = load_state(db, include_password_hashes=True)
    if consolider_caisses_par_agence(d):
        _persist(db, d)


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
    return role == "caissier"


def _premier_caissier_agence(d: dict, agence_id: str) -> dict | None:
    return next(
        (
            e
            for e in d["employes"]
            if e.get("agenceId") == agence_id and e.get("role") == "caissier" and e.get("actif")
        ),
        None,
    )


def _ouvrir_compte_caisse_si_besoin(d: dict, employe_id: str) -> dict:
    emp = next((e for e in d["employes"] if e["id"] == employe_id), None)
    if not emp or not _employe_a_compte_caisse(emp["role"]):
        return d
    if M.compte_caisse_agence(d["comptesCaisse"], emp["agenceId"]):
        return d
    if M.compte_caisse_de(d["comptesCaisse"], employe_id):
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


def _compte_caisse_operateur(d: dict, operateur_id: str, agence_id: str | None = None) -> tuple[dict, dict | None]:
    """Caisse unique de l'agence de l'opérateur (le chef n'a pas de caisse personnelle)."""
    op = next((e for e in d["employes"] if e["id"] == operateur_id), None)
    aid = agence_id or (op.get("agenceId") if op else None)
    if not aid:
        return d, None
    compte = M.compte_caisse_agence(d["comptesCaisse"], aid)
    if compte:
        return d, compte
    caissier = _premier_caissier_agence(d, aid)
    if caissier:
        d = _ouvrir_compte_caisse_si_besoin(d, caissier["id"])
        return d, M.compte_caisse_agence(d["comptesCaisse"], aid)
    if op and _employe_a_compte_caisse(op["role"]):
        d = _ouvrir_compte_caisse_si_besoin(d, op["id"])
        return d, M.compte_caisse_agence(d["comptesCaisse"], aid)
    return d, None


def _journee_caisse_en_cours(d: dict, agence_id: str | None) -> str | None:
    """Journée de caisse ouverte (non clôturée) de l'agence — aujourd'hui si plusieurs."""
    if not agence_id:
        return None
    ouvertes = [
        o["journee"]
        for o in (d.get("ouverturesCaisse") or [])
        if o.get("agenceId") == agence_id
        and o.get("journee")
        and not M.arret_caisse_agence(d.get("arretsCaisse") or [], agence_id, o["journee"])
    ]
    if not ouvertes:
        return None
    auj = M.aujourd_hui_iso()
    return auj if auj in ouvertes else max(ouvertes)


def _horodate_caisse_agence(d: dict, agence_id: str | None) -> str:
    """Horodate une opération de caisse sur la journée ouverte (pas « maintenant »)."""
    jour = _journee_caisse_en_cours(d, agence_id) or M.aujourd_hui_iso()
    return M.horodater_sur_jour(jour)


def _purger_mouvements_caisse_du_jour(
    d: dict,
    *,
    compte_id: str,
    jour: str,
    tx_ids: set[str],
    date_ouverture: str | None = None,
) -> dict:
    """Retire les mouvements du jour : par date, par transaction, et l'ajustement d'ouverture."""
    date_ouv = (date_ouverture or "")[:10]

    def _a_retirer(m: dict) -> bool:
        if m.get("compteCaisseId") != compte_id:
            return False
        if m.get("type") == "gel":
            return False
        if m.get("transactionId") and m.get("transactionId") in tx_ids:
            return True
        md = M.jour_iso_depuis_date(m.get("date") or "")
        if md == jour:
            return True
        if m.get("type") == "ouverture_journee" and (
            m.get("journee") == jour or (date_ouv and md == date_ouv)
        ):
            return True
        return False

    d["mouvementsCompteCaisse"] = [
        m for m in (d.get("mouvementsCompteCaisse") or []) if not _a_retirer(m)
    ]
    return d


def _appliquer_tx_caisse(d: dict, tx: dict) -> dict:
    if tx.get("annulee"):
        return d
    if not M.est_operation_caisse(tx["type"]) or not tx.get("operateurId"):
        return d
    next_d, compte = _compte_caisse_operateur(d, tx["operateurId"], tx.get("agenceId"))
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


def _origine_tontine(valeur) -> str:
    return "ancien" if valeur == "ancien" else "nouveau"


def _verif_caisse(d: dict, u: dict) -> str | None:
    if _est_admin(u):
        return None
    if not (_est_caissier(u) or _est_chef(u)):
        return None
    return M.message_blocage_caisse_journaliere(
        u["id"],
        d["transactions"],
        d["arretsCaisse"],
        d.get("ouverturesCaisse") or [],
        d.get("employes") or [],
    )


def _jour_collecte_payload(p: dict) -> str:
    brut = p.get("dateCollecte") or p.get("dateIso") or M.aujourd_hui_iso()
    return str(brut).strip()[:10]


def _erreur_date_collecte(d: dict, zone_id: str, jour: str) -> str | None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", jour or ""):
        return "Date de collecte invalide."
    if jour > M.aujourd_hui_iso():
        return "Impossible de saisir une collecte future."
    zone = next((z for z in d["zones"] if z["id"] == zone_id), None)
    code = zone["code"] if zone else "—"
    jz = M.journee_zone_du_jour(d["journeesCompteZone"], zone_id, jour)
    if not jz:
        return (
            f"Saisissez d'abord le montant reel collecté pour la zone {code} "
            f"(collecte du {jour})."
        )
    if jz.get("cloturee"):
        return f"La collecte tontine de la zone {code} est deja cloturee pour le {jour}."
    return None


def _erreur_caisse_jour_collecte(d: dict, carnet: dict, jour: str) -> str | None:
    """Dépôt / renouvellement / complément sont datés du jour de collecte : la caisse de l'agence
    doit être ouverte et non clôturée ce jour-là (tous rôles, admin compris)."""
    agence_id = carnet.get("agenceId") or _agence_du_client(d, carnet.get("clientId"))
    libelle = f"{jour[8:10]}/{jour[5:7]}/{jour[:4]}" if len(jour) == 10 else jour
    if not M.ouverture_caisse_agence(d.get("ouverturesCaisse") or [], agence_id, jour):
        return (
            f"La caisse du {libelle} n'est pas ouverte : choisissez la collecte d'un jour dont la caisse "
            "est ouverte, ou ouvrez d'abord cette journée."
        )
    if M.arret_caisse_agence(d.get("arretsCaisse") or [], agence_id, jour):
        return f"La caisse du {libelle} est clôturée : rouvrez-la pour faire un complément de saisie."
    return None


def _verif_solde_sortie(d: dict, u: dict, montant: float) -> str | None:
    if _est_admin(u):
        return None
    _, compte = _compte_caisse_operateur(d, u["id"], u.get("agenceId"))
    solde = compte["solde"] if compte else 0
    if solde < montant:
        return "Solde de caisse insuffisant."
    return None


def run_mutation(db: Session, current_user_id: str, action: str, payload: dict) -> dict[str, Any]:
    payload = payload or {}
    if action == "reinitialiserDemo":
        seed_database(db)
        from .migrations import repair_data_after_replace

        repair_data_after_replace(db)
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
        extra = dict(extra or {})
        data = _persist(db, new_d)
        return {"ok": True, "data": data, **extra}

    if isinstance(result, dict) and "data" in result:
        data = _persist(db, result["data"])
        out = {"ok": True, "data": data}
        for k, v in result.items():
            if k not in ("data", "erreur"):
                out[k] = v
        return out

    # handler returned new state dict directly
    if isinstance(result, dict) and "employes" in result:
        data = _persist(db, result)
        return {"ok": True, "data": data}

    return {"erreur": "Resultat de mutation invalide."}


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
    d["compteursOrdreZone"] = {**d.get("compteursOrdreZone", {}), zid: 0}
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
    if zone["code"] != code:
        d = _reprefixer_numeros_zone(d, zone_id=id_, nouveau_code=code)
    return (None, d, {})


def _reprefixer_numeros_zone(d: dict, *, zone_id: str, nouveau_code: str) -> dict:
    """Recalcule codeClient et numéros de carnets après changement du code zone."""
    clients_zone = [c for c in d["clients"] if c.get("zoneId") == zone_id]
    par_id = {}
    for c in clients_zone:
        nouveau = numero_carnet(nouveau_code, int(c.get("ordreZone") or suffixe_ordre_numero(c.get("codeClient"))))
        par_id[c["id"]] = nouveau
    d["clients"] = [
        {**c, "codeClient": par_id[c["id"]]} if c["id"] in par_id else c for c in d["clients"]
    ]
    zones = {z["id"]: z for z in d.get("zones") or []}
    carnets, _ = _aligner_carnets_sur_clients(d.get("carnets") or [], d["clients"], zones)
    d["carnets"] = carnets
    return d


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


def _rouvrir_journee_zone(d: dict, zone_id: str, jour: str) -> None:
    """Retire la clôture d'une journée zone (réel conservé, cumuls d'écart reculés)."""
    journee = M.journee_zone_du_jour(d.get("journeesCompteZone") or [], zone_id, jour)
    if not journee or not journee.get("cloturee"):
        return
    ecart = float(journee.get("ecart") or 0)
    d["journeesCompteZone"] = [
        {
            **j,
            "cloturee": False,
            "statut": "en_cours",
            "dateCloture": None,
        }
        if j["id"] == journee["id"]
        else j
        for j in d["journeesCompteZone"]
    ]
    compte = M.compte_zone_de(d["comptesZoneTontine"], zone_id)
    if compte and abs(ecart) > 0.005:
        cm = float(compte.get("cumulManquant") or 0)
        cs = float(compte.get("cumulSurplus") or 0)
        if ecart < 0:
            cm = max(0.0, cm - abs(ecart))
        else:
            cs = max(0.0, cs - ecart)
        d["comptesZoneTontine"] = [
            {**c, "cumulManquant": cm, "cumulSurplus": cs} if c["id"] == compte["id"] else c
            for c in d["comptesZoneTontine"]
        ]


def annuler_cloture_journee_zone(d, u, p):
    """Rouvre une journée zone déjà clôturée (le réel saisi est conservé)."""
    if not _a_droit(u, "operer_comptes") and not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    zone_id = p["zoneId"]
    jour = p.get("dateIso") or p.get("journee") or M.aujourd_hui_iso()
    zone = next((z for z in d["zones"] if z["id"] == zone_id), None)
    if not zone:
        return {"erreur": "Zone introuvable."}
    if not _est_admin(u) and zone["agenceId"] != u["agenceId"]:
        return {"erreur": "Cette zone n'appartient pas a votre agence."}
    d = copy.deepcopy(d)
    journee = M.journee_zone_du_jour(d["journeesCompteZone"], zone_id, jour)
    if not journee:
        return {"erreur": "Aucune journée enregistrée pour cette date."}
    if not journee.get("cloturee"):
        return {"erreur": "Cette journée n'est pas clôturée."}
    _rouvrir_journee_zone(d, zone_id, jour)
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
    zone_id = p.get("zoneId") or None
    agence_id = p.get("agenceId") or None
    zone = next((z for z in d["zones"] if z["id"] == zone_id), None) if zone_id else None
    if zone_id and not zone:
        return {"erreur": "Zone introuvable."}
    if zone:
        agence_id = zone["agenceId"]
        if not _est_admin(u) and agence_id != u.get("agenceId"):
            return {"erreur": "Cette zone n'appartient pas à votre agence."}
    elif agence_id:
        agence = next((a for a in d["agences"] if a["id"] == agence_id), None)
        if not agence:
            return {"erreur": "Agence introuvable."}
        if not _est_admin(u) and agence_id != u.get("agenceId"):
            return {"erreur": "Cette agence n'est pas la vôtre."}
    else:
        return {"erreur": "Indiquez une agence (client banque) ou une zone (client tontine)."}

    d = copy.deepcopy(d)
    cid = uid()
    origine = _origine_tontine(p.get("origineTontine"))
    if zone:
        ordre_zone = _prochain_ordre_zone(d, zone_id, code_zone=zone["code"])
        d["clients"].append(
            {
                "id": cid,
                "codeClient": numero_carnet(zone["code"], ordre_zone),
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
                "origineTontine": origine,
            }
        )
        d["compteursOrdreZone"] = {**d.get("compteursOrdreZone", {}), zone_id: ordre_zone}
    else:
        n = _prochain_ordre_banque(d)
        code_banque = numero_client_banque(n)
        d["clients"].append(
            {
                "id": cid,
                "codeClient": None,
                "agenceId": agence_id,
                "zoneId": None,
                "ordreZone": None,
                "ordreBanque": n,
                "codeClientBanque": code_banque,
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
                "origineTontine": origine,
            }
        )
        _sync_compteur_client_banque(d)
        return (None, d, {"id": cid, "codeClientBanque": code_banque})
    return (None, d, {"id": cid})


def inscrire_client_banque(d, u, p):
    """Attribue un n° banque à un client déjà inscrit (ex. tontine), sans ouvrir de compte."""
    if _est_caissier(u):
        return {"erreur": "Un caissier ne peut pas inscrire un client banque."}
    if not _est_admin(u) and not _a_droit(u, "gerer_clients"):
        return {"erreur": "Droit insuffisant."}
    id_ = p.get("id")
    client = next((c for c in d["clients"] if c["id"] == id_), None)
    if not client:
        return {"erreur": "Client introuvable."}
    if not client.get("actif"):
        return {"erreur": "Client inactif."}
    if client.get("codeClientBanque"):
        return {"erreur": "Ce client est déjà client banque."}
    if _est_chef(u) and client.get("agenceId") != u.get("agenceId"):
        return {"erreur": "Client hors de votre agence."}
    d = copy.deepcopy(d)
    _assurer_numero_client_banque(d, id_)
    client = next(c for c in d["clients"] if c["id"] == id_)
    return (None, d, {"id": id_, "codeClientBanque": client.get("codeClientBanque")})


def modifier_client(d, u, p):
    if _est_caissier(u):
        return {"erreur": "Un caissier ne peut pas modifier un client."}
    if not _a_droit(u, "gerer_clients") and not _est_admin(u):
        return {"erreur": "Droit insuffisant."}
    id_ = p["id"]
    patch = dict(p.get("patch") or {})
    d = copy.deepcopy(d)
    client = next((c for c in d["clients"] if c["id"] == id_), None)
    if not client:
        return {"erreur": "Client introuvable."}
    if not _est_admin(u) and client.get("agenceId") != u.get("agenceId"):
        return {"erreur": "Ce client n'appartient pas a votre agence."}

    champs_simples = {
        "nom",
        "prenom",
        "telephone",
        "email",
        "sexe",
        "profession",
        "adresse",
        "pieceIdentite",
        "origineTontine",
    }
    simple = {k: v for k, v in patch.items() if k in champs_simples}
    if "origineTontine" in simple:
        simple["origineTontine"] = _origine_tontine(simple.get("origineTontine"))

    new_zone_id = patch.get("zoneId")
    extra: dict[str, Any] = {}
    if new_zone_id is not None and new_zone_id != client.get("zoneId"):
        zone = next((z for z in d["zones"] if z["id"] == new_zone_id), None)
        if not zone:
            return {"erreur": "Zone introuvable."}
        if not zone.get("actif"):
            return {"erreur": "La zone de destination est inactive."}
        if not _est_admin(u) and zone["agenceId"] != u.get("agenceId"):
            return {"erreur": "Vous ne pouvez transferer un client que vers une zone de votre agence."}
        err, info = _appliquer_changement_zone_client(d, client_id=id_, zone=zone)
        if err:
            return {"erreur": err}
        extra = info

    if simple:
        d["clients"] = [{**c, **simple} if c["id"] == id_ else c for c in d["clients"]]
    return (None, d, extra)


def _appliquer_changement_zone_client(d: dict, *, client_id: str, zone: dict) -> tuple[str | None, dict]:
    """Change la zone/agence d'un client et recalcule N° client + numéros de carnets."""
    client = next((c for c in d["clients"] if c["id"] == client_id), None)
    if not client:
        return "Client introuvable.", {}

    zone_id = zone["id"]
    compteurs = dict(d.get("compteursOrdreZone") or {})
    new_ordre = _prochain_ordre_zone(d, zone_id, exclude_id=client_id, code_zone=zone["code"])
    nouveau_numero = numero_carnet(zone["code"], new_ordre)

    d["clients"] = [
        {
            **c,
            "zoneId": zone_id,
            "agenceId": zone["agenceId"],
            "ordreZone": new_ordre,
            "codeClient": nouveau_numero,
        }
        if c["id"] == client_id
        else c
        for c in d["clients"]
    ]
    d["compteursOrdreZone"] = {
        **compteurs,
        zone_id: max(int(compteurs.get(zone_id, 0) or 0), new_ordre),
    }
    zones = {z["id"]: z for z in d.get("zones") or []}
    carnets, _ = _aligner_carnets_sur_clients(d.get("carnets") or [], d["clients"], zones)
    d["carnets"] = carnets
    d["compteursOrdreZone"][zone_id] = _max_ordre_zone(d, zone_id)
    return None, {
        "codeClient": nouveau_numero,
        "ordreZone": new_ordre,
        "zoneId": zone_id,
        "agenceId": zone["agenceId"],
    }


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
    _sync_compteur_client_banque(d)
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
    if not client.get("zoneId"):
        return {"erreur": "Rattachez ce client à une zone pour ouvrir un carnet tontine."}
    zone = next((z for z in d["zones"] if z["id"] == client["zoneId"]), None)
    if not zone:
        return {"erreur": "Zone introuvable."}
    if any(
        c.get("clientId") == client_id and c.get("typeCarnet") == type_carnet
        for c in d.get("carnets") or []
    ):
        return {"erreur": "Ce client a déjà un carnet de ce type."}
    d = copy.deepcopy(d)
    numero = client.get("codeClient") or numero_carnet(zone["code"], int(client.get("ordreZone") or 1))
    if suffixe_ordre_numero(numero) <= 0 or len(re.sub(r"\D", "", numero)) < 6:
        numero = numero_carnet(zone["code"], int(client.get("ordreZone") or 1))
    cid = uid()
    date = _horodate_caisse_agence(d, zone["agenceId"])
    origine = _origine_tontine(p.get("origineTontine") or client.get("origineTontine"))
    d["clients"] = [
        {**c, "origineTontine": origine} if c["id"] == client_id else c for c in d["clients"]
    ]
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
            "reprisePapier": False,
        }
    )
    return {"data": d, "id": cid, "numero": numero}


def encaisser_cotisation(d, u, p):
    # Caisse contrôlée : celle du jour de collecte (voir _erreur_caisse_jour_collecte), tous rôles
    carnet_id = p["carnetId"]
    montant = float(p["montant"])
    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet or not carnet.get("actif"):
        return {"erreur": "Carnet introuvable."}
    if carnet.get("verrouille"):
        return {"erreur": "Ce carnet est verrouille."}

    jour = _jour_collecte_payload(p)
    err_jour = _erreur_caisse_jour_collecte(d, carnet, jour) or _erreur_date_collecte(d, carnet["zoneId"], jour)
    if err_jour:
        return {"erreur": err_jour}

    txs = d.get("transactions") or []
    payer_abo = bool(p.get("payerAbonnement"))
    payer_pc = bool(p.get("payerPc"))
    if payer_abo and not M.abonnement_a_saisir(carnet, d["mises"], txs):
        return {"erreur": "L'abonnement de cette annee est deja regle."}
    if payer_pc and not M.pc_a_saisir(carnet, d["mises"], txs):
        return {"erreur": "La P.C. de ce cycle est deja reglee ou non due."}

    prep = M.preparer_depot_tontine(montant, carnet["mise"], payer_abo, payer_pc)
    if not prep.get("ok"):
        return {"erreur": prep.get("erreur") or "Depot impossible."}

    plan = {"tranches": [], "cycleFinal": carnet["cycleActuel"]}
    if prep["nombreMises"] > 0:
        plan = M.repartir_depot_sur_cycles(carnet, d["mises"], prep["nombreMises"], txs)
        if not plan.get("ok"):
            return {"erreur": plan.get("erreur") or "Depot impossible."}

    date = M.horodater_sur_jour(jour)
    note_collecte = f" (collecte du {jour})" if jour != M.aujourd_hui_iso() else ""
    nouvelles = []
    if payer_abo:
        cycle_abo = M.cycle_courant_effectif(carnet, d["mises"])
        nouvelles.append(
            _mk_tx(
                u,
                {
                    "type": "vente_carnet",
                    "clientId": carnet["clientId"],
                    "montant": M.PRIX_CARNET,
                    "date": date,
                    "description": (
                        f"Abonnement carnet {carnet['numero']} — {_nom_client(d, carnet['clientId'])} "
                        f"(carnet {M.annee_carnet(cycle_abo)}, cycle 1/{M.CYCLES_PAR_CARNET}){note_collecte}"
                    ),
                },
            )
        )
    if payer_pc:
        cycle_pc = M.cycle_courant_effectif(carnet, d["mises"])
        nouvelles.append(
            _mk_tx(
                u,
                {
                    "type": "commission_tontine",
                    "clientId": carnet["clientId"],
                    "montant": carnet["mise"],
                    "date": date,
                    "description": (
                        f"Premiere cotisation (P.C) — {_nom_client(d, carnet['clientId'])} "
                        f"(carnet {carnet['numero']}, cycle {cycle_pc}){note_collecte}"
                    ),
                },
            )
        )

    nouvelles_mises = []
    pc_restant = 1 if payer_pc else 0
    for tr in plan["tranches"]:
        cycle_depot = int(tr["cycle"])
        nombre = int(tr["nombre"])
        nouvelles_mises.append(
            {
                "id": uid(),
                "carnetId": carnet_id,
                "cycle": cycle_depot,
                "nombreMises": nombre,
                "montant": carnet["mise"] * nombre,
                "date": date,
            }
        )
        nombre_cash = nombre
        if pc_restant and nombre_cash > 0:
            oter = min(pc_restant, nombre_cash)
            nombre_cash -= oter
            pc_restant -= oter
        if nombre_cash > 0:
            nouvelles.append(
                _mk_tx(
                    u,
                    {
                        "type": "mise_tontine",
                        "clientId": carnet["clientId"],
                        "montant": carnet["mise"] * nombre_cash,
                        "date": date,
                        "description": (
                            f"Depot x{nombre_cash} — {_nom_client(d, carnet['clientId'])} "
                            f"(carnet {carnet['numero']}, cycle {cycle_depot}){note_collecte}"
                        ),
                    },
                )
            )

    d["mises"] = [*d["mises"], *nouvelles_mises]
    if plan.get("cycleFinal") and plan["cycleFinal"] != carnet["cycleActuel"]:
        d["carnets"] = [
            {**c, "cycleActuel": plan["cycleFinal"]} if c["id"] == carnet_id else c for c in d["carnets"]
        ]
    d = _enregistrer_tx(d, nouvelles)
    return (None, d, {})


def renouveler_carnet(d, u, p):
    """Encaissement des 300 F et ouverture de 12 nouveaux cycles, après une année complète."""
    carnet_id = p["carnetId"]
    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet or not carnet.get("actif"):
        return {"erreur": "Carnet introuvable."}
    if carnet.get("verrouille"):
        return {"erreur": "Ce carnet est verrouille."}
    if not M.besoin_renouvellement_carnet(carnet, d["mises"], d.get("transactions") or []):
        return {"erreur": "Ce carnet n'est pas encore a renouveler (12 cycles non termines)."}

    jour = _jour_collecte_payload(p)
    err_jour = _erreur_caisse_jour_collecte(d, carnet, jour) or _erreur_date_collecte(d, carnet["zoneId"], jour)
    if err_jour:
        return {"erreur": err_jour}

    ouverte = M.annee_carnet_ouverte(carnet, d["mises"], d.get("transactions") or [])
    annee_nouvelle = ouverte + 1
    cycle_cible = ouverte * M.CYCLES_PAR_CARNET + 1
    if int(carnet.get("cycleActuel") or 1) < cycle_cible:
        d["carnets"] = [
            {**c, "cycleActuel": cycle_cible} if c["id"] == carnet_id else c for c in d["carnets"]
        ]
        carnet = next(c for c in d["carnets"] if c["id"] == carnet_id)

    date = M.horodater_sur_jour(jour)
    note_collecte = f" (collecte du {jour})" if jour != M.aujourd_hui_iso() else ""
    d = _enregistrer_tx(
        d,
        [
            _mk_tx(
                u,
                {
                    "type": "vente_carnet",
                    "clientId": carnet["clientId"],
                    "montant": M.PRIX_CARNET,
                    "date": date,
                    "description": (
                        f"Renouvellement du carnet {carnet['numero']} — {_nom_client(d, carnet['clientId'])} "
                        f"(carnet {annee_nouvelle}, cycle 1/{M.CYCLES_PAR_CARNET}){note_collecte}"
                    ),
                },
            )
        ],
    )
    return (None, d, {"annee": annee_nouvelle, "cycle": cycle_cible})


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
        jour = _jour_collecte_payload(p)
        err_jour = _erreur_caisse_jour_collecte(d, carnet, jour) or _erreur_date_collecte(d, carnet["zoneId"], jour)
        if err_jour:
            return {"erreur": err_jour}
        date = M.horodater_sur_jour(jour)
    else:
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
                            + (f" (collecte du {jour})" if jour != M.aujourd_hui_iso() else "")
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
    retirables = M.carreaux_retirables(carnet, d["mises"], cycle, d.get("transactions") or [])
    if nombre > retirables:
        return {"erreur": "Pas assez de carreaux."}
    montant = carnet["mise"] * nombre
    err2 = _verif_solde_sortie(d, u, montant)
    if err2:
        return {"erreur": err2}
    date = _horodate_caisse_agence(d, carnet.get("agenceId") or u.get("agenceId"))
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


def _infos_cloture_tx(tx: dict) -> tuple[str, int] | None:
    """(n° carnet, cycle) si la transaction est une clôture anticipée de cycle (avec ou sans retrait)."""
    desc = tx.get("description") or ""
    if tx.get("type") == "retrait_tontine":
        if "clôture anticipée" not in desc.lower():
            return None
    elif tx.get("type") != "cloture_cycle":
        return None
    m = re.search(r"\(carnet\s+(\S+),\s*cycle\s+(\d+)\)", desc)
    return (m.group(1), int(m.group(2))) if m else None


def cloturer_cycle(d, u, p):
    """Clôture anticipée du cycle en cours, même s'il n'est pas plein ; le cycle suivant s'ouvre.

    - avecRetrait (défaut) : les mises du cycle (hors P.C. payée) sont remises en espèces.
    - sans retrait : aucun mouvement d'argent, les mises restent disponibles sur le cycle
      clôturé (retrait ou transfert plus tard). Une ligne à 0 F trace la clôture au journal.
    """
    avec_retrait = p.get("avecRetrait", True) is not False
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    if not _a_droit(u, "operer_comptes"):
        return {"erreur": "Droit insuffisant."}
    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == p.get("carnetId")), None)
    if not carnet or not carnet.get("actif"):
        return {"erreur": "Carnet introuvable."}
    if carnet.get("verrouille"):
        return {"erreur": "Carnet verrouille."}
    agence_carnet = carnet.get("agenceId") or _agence_du_client(d, carnet["clientId"])
    if not _est_admin(u) and agence_carnet != u.get("agenceId"):
        return {"erreur": "Ce carnet n'appartient pas à votre agence."}
    if avec_retrait and not M.eligibilite_retrait_carnet(carnet, d["mises"]).get("autorise"):
        return {"erreur": "Retrait non autorise pour ce type de carnet."}

    cycle = M.cycle_courant_effectif(carnet, d["mises"])
    if p.get("cycle") is not None and int(p["cycle"]) != cycle:
        return {"erreur": f"Seul le cycle en cours (cycle {cycle}) peut être clôturé."}
    if M.carreaux_deposes(carnet, d["mises"], cycle) <= 0:
        return {"erreur": "Aucune mise sur ce cycle : rien à clôturer."}
    txs = d.get("transactions") or []
    nombre = M.carreaux_retirables(carnet, d["mises"], cycle, txs)
    montant = carnet["mise"] * nombre
    if avec_retrait:
        if nombre <= 0:
            return {"erreur": "Rien à rembourser sur ce cycle (seule la P.C. y est inscrite)."}
        err2 = _verif_solde_sortie(d, u, montant)
        if err2:
            return {"erreur": err2}

    date = _horodate_caisse_agence(d, agence_carnet or u.get("agenceId"))
    nom = _nom_client(d, carnet["clientId"])
    if avec_retrait:
        d["mises"].append(
            {
                "id": uid(),
                "carnetId": carnet["id"],
                "cycle": cycle,
                "nombreMises": -nombre,
                "montant": -montant,
                "date": date,
            }
        )
        tx = {
            "type": "retrait_tontine",
            "montant": montant,
            "description": (
                f"Retrait {carnet['numero']} x{nombre} — {nom} "
                f"(carnet {carnet['numero']}, cycle {cycle}) — clôture anticipée du cycle"
            ),
        }
    else:
        tx = {
            "type": "cloture_cycle",
            "montant": 0,
            "description": (
                f"Clôture sans retrait {carnet['numero']} — {nom} (carnet {carnet['numero']}, cycle {cycle}) — "
                f"{nombre} mise(s) restent disponibles ({int(montant)} F)"
            ),
        }
    carnet_maj = {**carnet, "cyclesClotures": sorted({*(carnet.get("cyclesClotures") or []), cycle})}
    carnet_maj["cycleActuel"] = M.cycle_courant_effectif(carnet_maj, d["mises"])
    d["carnets"] = [carnet_maj if c["id"] == carnet["id"] else c for c in d["carnets"]]
    d = _enregistrer_tx(d, [_mk_tx(u, {**tx, "clientId": carnet["clientId"], "date": date})])
    return (
        None,
        d,
        {
            "montant": montant,
            "nombreMises": nombre,
            "avecRetrait": avec_retrait,
            "cycleSuivant": carnet_maj["cycleActuel"],
        },
    )


def _agence_du_client(d: dict, client_id: str | None) -> str | None:
    c = next((x for x in d["clients"] if x["id"] == client_id), None)
    return c.get("agenceId") if c else None


def _motif_transfert(p: dict) -> str:
    return " ".join(str(p.get("motif") or "").split())[:200]


def _controle_transfert(
    d: dict, u: dict, *, client_source_id: str, client_dest_id: str, agences: set[str | None]
) -> str | None:
    """Droits communs aux transferts (tontine → compte, compte → compte)."""
    if not _a_droit(u, "operer_comptes"):
        return "Droit insuffisant."
    if client_source_id != client_dest_id and not (_est_admin(u) or _est_chef(u)):
        return "Transfert vers un autre client : réservé à l'administrateur ou au chef d'agence."
    if not _est_admin(u) and agences != {u.get("agenceId")}:
        return "Le transfert est limité aux comptes de votre agence."
    return None


def _suffixe_transfert(d: dict, client_source_id: str, client_dest_id: str, motif: str) -> str:
    s = f" — {_nom_client(d, client_source_id)}"
    if client_dest_id != client_source_id:
        s += f" → {_nom_client(d, client_dest_id)}"
    if motif:
        s += f" — Motif : {motif}"
    return s


def transfert_tontine_compte(d, u, p):
    """Vire des carreaux d'un carnet vers un compte banque (même client ou non), sans mouvement de caisse."""
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    carnet_id = p.get("carnetId")
    compte_id = p.get("compteId")
    cycle = int(p.get("cycle") or 0)
    nombre = int(p.get("nombreCarreaux") or 0)
    motif = _motif_transfert(p)
    if nombre <= 0:
        return {"erreur": "Nombre invalide."}
    if not compte_id:
        return {"erreur": "Indiquez le compte banque destinataire."}

    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet:
        return {"erreur": "Carnet introuvable."}
    if carnet.get("verrouille"):
        return {"erreur": "Carnet verrouille."}
    elig = M.eligibilite_retrait_carnet(carnet, d["mises"])
    if not elig.get("autorise"):
        return {"erreur": "Retrait non autorise pour ce type de carnet."}
    retirables = M.carreaux_retirables(carnet, d["mises"], cycle, d.get("transactions") or [])
    if nombre > retirables:
        return {"erreur": "Pas assez de carreaux."}

    compte = next((c for c in d["comptes"] if c["id"] == compte_id), None)
    if not compte:
        return {"erreur": "Compte banque introuvable."}
    if compte.get("verrouille"):
        return {"erreur": "Ce compte est verrouille."}
    err = _controle_transfert(
        d,
        u,
        client_source_id=carnet["clientId"],
        client_dest_id=compte["clientId"],
        agences={
            carnet.get("agenceId") or _agence_du_client(d, carnet["clientId"]),
            _agence_du_client(d, compte["clientId"]),
        },
    )
    if err:
        return {"erreur": err}

    montant = carnet["mise"] * nombre
    if montant <= 0:
        return {"erreur": "Montant invalide."}

    date = _horodate_caisse_agence(d, carnet.get("agenceId") or u.get("agenceId"))
    nature = "épargne" if compte.get("type") == "epargne" else "courant"
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
    d["comptes"] = [
        {**c, "solde": c["solde"] + montant} if c["id"] == compte_id else c for c in d["comptes"]
    ]
    d["mouvements"].append(
        {
            "id": uid(),
            "compteId": compte_id,
            "type": "depot",
            "montant": montant,
            "date": date,
            "note": f"Transfert depuis carnet {carnet['numero']} cycle {cycle}",
        }
    )
    tx = _mk_tx(
        u,
        {
            "type": "transfert_tontine_compte",
            "clientId": carnet["clientId"],
            "clientDestinationId": compte["clientId"],
            "montant": montant,
            "date": date,
            "description": (
                f"Transfert tontine {carnet['numero']} → {compte['numero']} ({nature}) "
                f"x{nombre} (carnet {carnet['numero']}, cycle {cycle})"
                + _suffixe_transfert(d, carnet["clientId"], compte["clientId"], motif)
            ),
        },
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {})


def _erreur_montant_mises(montant: float, mise_dest: float, mise_src: float | None = None) -> str | None:
    """Le montant transféré vers un carnet doit tomber juste en mises du carnet destinataire."""
    if mise_dest <= 0:
        return "Mise du carnet destinataire invalide."
    if abs(montant % mise_dest) < 1e-6:
        return None
    if mise_src:
        a, b = int(round(mise_src)), int(round(mise_dest))
        pas = b // math.gcd(a, b) if a > 0 and b > 0 else 0
        if pas > 0:
            return (
                f"Le montant ({int(montant)} F) doit être un multiple de la mise du carnet destinataire "
                f"({int(mise_dest)} F) : transférez un multiple de {pas} mise(s)."
            )
    return f"Le montant doit être un multiple de la mise du carnet destinataire ({int(mise_dest)} F)."


def _deposer_mises_transfert(d: dict, carnet: dict, montant: float, date: str, tx_id: str) -> tuple[str | None, dict, int]:
    """Dépose `montant` en mises sur le carnet destinataire (cycle en cours puis suivants), sans P.C.
    ni abonnement : un transfert n'achète que des mises. Les lignes sont liées à la transaction."""
    nombre = int(round(montant / float(carnet["mise"])))
    plan = M.repartir_depot_sur_cycles(carnet, d["mises"], nombre, d.get("transactions") or [])
    if not plan.get("ok"):
        return f"Carnet destinataire {carnet['numero']} : {plan.get('erreur') or 'dépôt impossible.'}", d, 0
    for tr in plan["tranches"]:
        d["mises"].append(
            {
                "id": uid(),
                "carnetId": carnet["id"],
                "cycle": int(tr["cycle"]),
                "nombreMises": int(tr["nombre"]),
                "montant": float(carnet["mise"]) * int(tr["nombre"]),
                "date": date,
                "transactionId": tx_id,
            }
        )
    if plan.get("cycleFinal") and plan["cycleFinal"] != carnet.get("cycleActuel"):
        d["carnets"] = [
            {**c, "cycleActuel": plan["cycleFinal"]} if c["id"] == carnet["id"] else c for c in d["carnets"]
        ]
    return None, d, nombre


def _erreur_carnet_destinataire(d: dict, carnet: dict | None) -> str | None:
    if not carnet or not carnet.get("actif"):
        return "Carnet destinataire introuvable."
    if carnet.get("verrouille"):
        return f"Le carnet destinataire {carnet['numero']} est verrouillé."
    if M.besoin_renouvellement_carnet(carnet, d["mises"], d.get("transactions") or []):
        return f"Le carnet destinataire {carnet['numero']} doit d'abord être renouvelé (300 F)."
    return None


def transfert_tontine_tontine(d, u, p):
    """Vire des mises d'un carnet (cycle choisi) vers un autre carnet, même client ou non, sans caisse."""
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    cycle = int(p.get("cycle") or 0)
    nombre = int(p.get("nombreCarreaux") or 0)
    motif = _motif_transfert(p)
    if nombre <= 0:
        return {"erreur": "Nombre de mises invalide."}
    d = copy.deepcopy(d)
    source = next((c for c in d["carnets"] if c["id"] == p.get("carnetSourceId")), None)
    dest = next((c for c in d["carnets"] if c["id"] == p.get("carnetDestinationId")), None)
    if not source or not source.get("actif"):
        return {"erreur": "Carnet source introuvable."}
    if dest and dest["id"] == source["id"]:
        return {"erreur": "Le carnet source et le carnet destinataire doivent être différents."}
    if source.get("verrouille"):
        return {"erreur": f"Le carnet source {source['numero']} est verrouillé."}
    if not M.eligibilite_retrait_carnet(source, d["mises"]).get("autorise"):
        return {"erreur": "Retrait non autorise pour ce type de carnet."}
    if nombre > M.carreaux_retirables(source, d["mises"], cycle, d.get("transactions") or []):
        return {"erreur": "Pas assez de mises disponibles sur ce cycle."}
    err = _erreur_carnet_destinataire(d, dest)
    if err:
        return {"erreur": err}
    err = _controle_transfert(
        d,
        u,
        client_source_id=source["clientId"],
        client_dest_id=dest["clientId"],
        agences={
            source.get("agenceId") or _agence_du_client(d, source["clientId"]),
            dest.get("agenceId") or _agence_du_client(d, dest["clientId"]),
        },
    )
    if err:
        return {"erreur": err}
    montant = float(source["mise"]) * nombre
    err = _erreur_montant_mises(montant, float(dest["mise"]), float(source["mise"]))
    if err:
        return {"erreur": err}

    date = _horodate_caisse_agence(d, source.get("agenceId") or u.get("agenceId"))
    tx = _mk_tx(u, {"type": "transfert_tontine_tontine", "clientId": source["clientId"],
                    "clientDestinationId": dest["clientId"], "montant": montant, "date": date})
    d["mises"].append(
        {
            "id": uid(),
            "carnetId": source["id"],
            "cycle": cycle,
            "nombreMises": -nombre,
            "montant": -montant,
            "date": date,
            "transactionId": tx["id"],
        }
    )
    err, d, nombre_dest = _deposer_mises_transfert(d, dest, montant, date, tx["id"])
    if err:
        return {"erreur": err}
    tx["description"] = (
        f"Transfert tontine {source['numero']} → carnet {dest['numero']} x{nombre} "
        f"(carnet {source['numero']}, cycle {cycle}) → x{nombre_dest} sur {dest['numero']}"
        + _suffixe_transfert(d, source["clientId"], dest["clientId"], motif)
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {"nombreMisesDestination": nombre_dest})


def transfert_compte_tontine(d, u, p):
    """Vire un montant d'un compte courant / épargne vers un carnet (en mises), même client ou non, sans caisse."""
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    montant = float(p.get("montant") or 0)
    motif = _motif_transfert(p)
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    d = copy.deepcopy(d)
    compte = next((c for c in d["comptes"] if c["id"] == p.get("compteSourceId")), None)
    dest = next((c for c in d["carnets"] if c["id"] == p.get("carnetDestinationId")), None)
    if not compte:
        return {"erreur": "Compte source introuvable."}
    if compte.get("verrouille"):
        return {"erreur": f"Le compte source {compte['numero']} est verrouillé."}
    err = _erreur_carnet_destinataire(d, dest)
    if err:
        return {"erreur": err}
    err = _controle_transfert(
        d,
        u,
        client_source_id=compte["clientId"],
        client_dest_id=dest["clientId"],
        agences={_agence_du_client(d, compte["clientId"]), dest.get("agenceId") or _agence_du_client(d, dest["clientId"])},
    )
    if err:
        return {"erreur": err}
    if float(compte["solde"]) < montant - 0.005:
        return {"erreur": "Solde insuffisant sur le compte source."}
    err = _erreur_montant_mises(montant, float(dest["mise"]))
    if err:
        return {"erreur": err}

    date = _horodate_caisse_agence(d, _agence_du_client(d, compte["clientId"]) or u.get("agenceId"))
    tx = _mk_tx(u, {"type": "transfert_compte_tontine", "clientId": compte["clientId"],
                    "clientDestinationId": dest["clientId"], "montant": montant, "date": date})
    err, d, nombre_dest = _deposer_mises_transfert(d, dest, montant, date, tx["id"])
    if err:
        return {"erreur": err}
    d["comptes"] = [{**c, "solde": c["solde"] - montant} if c["id"] == compte["id"] else c for c in d["comptes"]]
    d["mouvements"].append(
        {
            "id": uid(),
            "compteId": compte["id"],
            "type": "retrait",
            "montant": montant,
            "date": date,
            "note": f"Transfert vers carnet {dest['numero']}" + (f" — {motif}" if motif else ""),
        }
    )
    nature = "épargne" if compte.get("type") == "epargne" else "courant"
    tx["description"] = (
        f"Transfert compte {compte['numero']} ({nature}) → carnet {dest['numero']} x{nombre_dest}"
        + _suffixe_transfert(d, compte["clientId"], dest["clientId"], motif)
    )
    d = _enregistrer_tx(d, [tx])
    return (None, d, {"nombreMisesDestination": nombre_dest})


def _annuler_mises_transfert(d: dict, tx: dict) -> tuple[str | None, dict]:
    """Retire les lignes de mises liées à un transfert tontine et recalcule les cycles des carnets."""
    lignes = [mi for mi in d.get("mises") or [] if mi.get("transactionId") == tx["id"]]
    if not lignes:
        return "Mises liées au transfert introuvables.", d
    entrees = [mi for mi in lignes if int(mi.get("nombreMises") or 0) > 0]
    # Destination : refus si des dépôts ont été faits depuis sur les cycles suivants
    for carnet_id in {mi["carnetId"] for mi in entrees}:
        premier = min(int(mi["cycle"]) for mi in entrees if mi["carnetId"] == carnet_id)
        if any(
            x.get("carnetId") == carnet_id
            and x.get("transactionId") != tx["id"]
            and int(x.get("nombreMises") or 0) > 0
            and int(x.get("cycle") or 0) > premier
            and (x.get("date") or "") > (tx.get("date") or "")
            for x in d["mises"]
        ):
            return "Annulation impossible : des dépôts ont été faits depuis sur les cycles suivants du carnet destinataire.", d
    ids = {mi["id"] for mi in lignes}
    d["mises"] = [mi for mi in d["mises"] if mi["id"] not in ids]
    for carnet_id in {mi["carnetId"] for mi in lignes}:
        carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
        if not carnet:
            continue
        for cycle in {int(mi["cycle"]) for mi in lignes if mi["carnetId"] == carnet_id}:
            if M.carreaux_nets(carnet, d["mises"], cycle) < 0:
                return (
                    f"Annulation impossible : les mises transférées ont déjà été retirées du carnet {carnet['numero']}.",
                    d,
                )
        d = _recalculer_cycle_actuel_carnet(d, carnet_id)
    return None, d


def transfert_compte_compte(d, u, p):
    """Vire un montant d'un compte courant/épargne vers un autre (même client ou non), sans mouvement de caisse."""
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
    source_id = p.get("compteSourceId")
    dest_id = p.get("compteDestinationId")
    montant = float(p.get("montant") or 0)
    motif = _motif_transfert(p)
    if montant <= 0:
        return {"erreur": "Montant invalide."}
    if not source_id or not dest_id:
        return {"erreur": "Indiquez le compte source et le compte destinataire."}
    if source_id == dest_id:
        return {"erreur": "Le compte source et le compte destinataire doivent être différents."}

    d = copy.deepcopy(d)
    source = next((c for c in d["comptes"] if c["id"] == source_id), None)
    dest = next((c for c in d["comptes"] if c["id"] == dest_id), None)
    if not source:
        return {"erreur": "Compte source introuvable."}
    if not dest:
        return {"erreur": "Compte destinataire introuvable."}
    if source.get("verrouille"):
        return {"erreur": f"Le compte source {source['numero']} est verrouillé."}
    if dest.get("verrouille"):
        return {"erreur": f"Le compte destinataire {dest['numero']} est verrouillé."}
    err = _controle_transfert(
        d,
        u,
        client_source_id=source["clientId"],
        client_dest_id=dest["clientId"],
        agences={_agence_du_client(d, source["clientId"]), _agence_du_client(d, dest["clientId"])},
    )
    if err:
        return {"erreur": err}
    if float(source["solde"]) < montant - 0.005:
        return {"erreur": "Solde insuffisant sur le compte source."}

    date = _horodate_caisse_agence(d, _agence_du_client(d, source["clientId"]) or u.get("agenceId"))
    d["comptes"] = [
        {**c, "solde": c["solde"] - montant}
        if c["id"] == source_id
        else {**c, "solde": c["solde"] + montant}
        if c["id"] == dest_id
        else c
        for c in d["comptes"]
    ]
    d["mouvements"].extend(
        [
            {
                "id": uid(),
                "compteId": source_id,
                "type": "retrait",
                "montant": montant,
                "date": date,
                "note": f"Transfert vers {dest['numero']}" + (f" — {motif}" if motif else ""),
            },
            {
                "id": uid(),
                "compteId": dest_id,
                "type": "depot",
                "montant": montant,
                "date": date,
                "note": f"Transfert depuis {source['numero']}" + (f" — {motif}" if motif else ""),
            },
        ]
    )
    nature = lambda c: "épargne" if c.get("type") == "epargne" else "courant"  # noqa: E731
    tx = _mk_tx(
        u,
        {
            "type": "transfert_compte_compte",
            "clientId": source["clientId"],
            "clientDestinationId": dest["clientId"],
            "montant": montant,
            "date": date,
            "description": (
                f"Transfert compte {source['numero']} ({nature(source)}) → {dest['numero']} ({nature(dest)})"
                + _suffixe_transfert(d, source["clientId"], dest["clientId"], motif)
            ),
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


def _txs_lies_au_carnet(d: dict, carnet: dict) -> list[dict]:
    """Transactions de caisse rattachables à ce carnet (vente, dépôts, P.C., retraits, complément)."""
    client_id = carnet["clientId"]
    numero = carnet.get("numero") or ""
    types = {
        "vente_carnet",
        "mise_tontine",
        "commission_tontine",
        "complement_mise",
        "retrait_tontine",
        "transfert_tontine_compte",
    }
    autres = [
        c for c in d.get("carnets") or [] if c.get("clientId") == client_id and c["id"] != carnet["id"]
    ]
    seul = len(autres) == 0
    out: list[dict] = []
    vus: set[str] = set()
    for t in d.get("transactions") or []:
        if t.get("type") not in types or t.get("clientId") != client_id:
            continue
        desc = t.get("description") or ""
        num_desc = _numero_carnet_depuis_description(desc)
        lie = False
        if numero and numero in desc:
            lie = True
        elif num_desc and num_desc == numero:
            lie = True
        else:
            trouve = _trouver_mise_tontine(
                d,
                client_id=client_id,
                typ=t["type"],
                montant=float(t.get("montant") or 0),
                date_tx=t.get("date") or "",
                description=desc,
            )
            if trouve and trouve[0]["id"] == carnet["id"]:
                lie = True
            elif seul:
                lie = True
        if lie and t["id"] not in vus:
            vus.add(t["id"])
            out.append(t)
    return out


def _retirer_txs_et_mouvements_caisse(d: dict, tx_ids: set[str]) -> dict:
    if not tx_ids:
        return d
    comptes_ids: set[str] = set()
    for m in d.get("mouvementsCompteCaisse") or []:
        if m.get("transactionId") in tx_ids:
            comptes_ids.add(m.get("compteCaisseId") or "")
    comptes_ids.discard("")
    d["mouvementsCompteCaisse"] = [
        m for m in (d.get("mouvementsCompteCaisse") or []) if m.get("transactionId") not in tx_ids
    ]
    d["transactions"] = [t for t in (d.get("transactions") or []) if t.get("id") not in tx_ids]
    for cid in comptes_ids:
        compte = next((c for c in d.get("comptesCaisse") or [] if c["id"] == cid), None)
        emp_id = (compte or {}).get("employeId") or ""
        if emp_id:
            d = _recalculer_solde_compte_caisse(d, emp_id, 0.0)
        else:
            d["comptesCaisse"] = [{**c, "solde": 0.0} if c["id"] == cid else c for c in d["comptesCaisse"]]
    return d


def supprimer_carnet(d, u, p):
    """Admin : supprime un carnet, ses mises et les opérations de caisse liées, pour pouvoir le rouvrir."""
    if not _est_admin(u):
        return {"erreur": "Seul l'administrateur peut supprimer un carnet."}
    id_ = p.get("id") or p.get("carnetId")
    carnet = next((c for c in d.get("carnets") or [] if c["id"] == id_), None)
    if not carnet:
        return {"erreur": "Carnet introuvable."}

    d = copy.deepcopy(d)
    carnet = next((c for c in d["carnets"] if c["id"] == id_), None)
    txs = _txs_lies_au_carnet(d, carnet)
    if any(t.get("type") == "transfert_tontine_compte" and M.est_tx_active(t) for t in txs):
        return {
            "erreur": "Impossible : ce carnet a des virements vers un compte banque. Annulez-les d'abord."
        }
    mises = [mi for mi in d.get("mises") or [] if mi.get("carnetId") == id_]
    tx_liees = {mi.get("transactionId") for mi in mises if mi.get("transactionId")}
    if any(t["id"] in tx_liees and M.est_tx_active(t) for t in d.get("transactions") or []):
        return {"erreur": "Impossible : ce carnet a des transferts (vers ou depuis un autre carnet / compte). Annulez-les d'abord."}

    jours: set[str] = set()
    ouverture = M.jour_iso_depuis_date(carnet.get("dateOuverture") or "")
    if ouverture:
        jours.add(ouverture)
    for mi in mises:
        j = M.jour_iso_depuis_date(mi.get("date") or "")
        if j:
            jours.add(j)
    for t in txs:
        j = M.jour_iso_depuis_date(t.get("date") or "")
        if j:
            jours.add(j)

    agence_id = carnet.get("agenceId")
    zone_id = carnet.get("zoneId")
    for jour in sorted(jours):
        if agence_id and M.arret_caisse_agence(d.get("arretsCaisse") or [], agence_id, jour):
            return {
                "erreur": f"Impossible : la caisse du {jour} est déjà clôturée. "
                "Annulez d'abord cette clôture, ou supprimez le carnet avant l'arrêt de caisse."
            }
        if zone_id:
            jz = M.journee_zone_du_jour(d.get("journeesCompteZone") or [], zone_id, jour)
            if jz and jz.get("cloturee"):
                return {
                    "erreur": f"Impossible : la journée tontine de la zone est clôturée pour le {jour}."
                }

    d["mises"] = [mi for mi in d.get("mises") or [] if mi.get("carnetId") != id_]
    d = _retirer_txs_et_mouvements_caisse(d, {t["id"] for t in txs})
    d["carnets"] = [c for c in d["carnets"] if c["id"] != id_]
    return (None, d, {"clientId": carnet["clientId"], "numero": carnet.get("numero")})


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
        return {"erreur": "Indiquez le caissier qui validera l'ouverture."}

    from .config import settings

    client = next((c for c in d["clients"] if c["id"] == client_id), None)
    if not client:
        return {"erreur": "Client introuvable."}
    payer_ps = True if p.get("payerPartSociale") is None else bool(p.get("payerPartSociale"))
    payer_ad = True if p.get("payerAdhesion") is None else bool(p.get("payerAdhesion"))
    part_sociale = float(settings.part_sociale_montant) if payer_ps else 0.0
    droit = (
        float(settings.droit_adhesion_promo_montant if promotion else settings.droit_adhesion_montant)
        if payer_ad
        else 0.0
    )
    caissier = next((e for e in d["employes"] if e["id"] == caissier_id and e.get("actif")), None)
    if not caissier or caissier.get("role") != "caissier":
        return {"erreur": "Indiquez un caissier de l'agence (le chef d'agence n'a pas de caisse)."}
    if _est_chef(u) and caissier["agenceId"] != u["agenceId"]:
        return {"erreur": "Le caissier doit appartenir à votre agence."}
    if _est_chef(u) and client["agenceId"] != u["agenceId"]:
        return {"erreur": "Client hors de votre agence."}
    if not client.get("codeClientBanque"):
        return {"erreur": "Inscrivez d'abord ce client comme client banque."}

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
    _assurer_numero_client_banque(d, client_id)
    ordre = _prochain_ordre_compte_solde(d)
    cid = uid()
    numero = numero_compte_solde(ordre)
    date = _horodate_caisse_agence(d, operateur.get("agenceId"))
    d["compteurs"] = {**d["compteurs"], "compte": max(_ordres_compte_solde_occupes(d) | {ordre})}
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
    if droit > 0:
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
    txs = []
    if part_sociale > 0:
        txs.append(
            _mk_tx(
                operateur,
                {
                    "type": "part_sociale",
                    "clientId": client_id,
                    "montant": part_sociale,
                    "date": date,
                    "description": f"Part sociale ouverture {numero} ({type_}) — {_nom_client(d, client_id)}",
                },
            )
        )
    if droit > 0:
        txs.append(
            _mk_tx(
                operateur,
                {
                    "type": "droit_adhesion",
                    "clientId": client_id,
                    "montant": droit,
                    "date": date,
                    "description": f"Droit d'adhésion{' promo' if promotion else ''} {numero} ({type_}) — {_nom_client(d, client_id)} (crédité sur le compte)",
                },
            )
        )
    if txs:
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
        caissier["id"],
        d["transactions"],
        d["arretsCaisse"],
        d.get("ouverturesCaisse") or [],
        d.get("employes") or [],
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
    date = _horodate_caisse_agence(d, u.get("agenceId"))
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
    date = _horodate_caisse_agence(d, u.get("agenceId"))
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


def supprimer_compte(d, u, p):
    """Supprime un compte client (admin uniquement). Solde doit être à zéro."""
    if not _est_admin(u):
        return {"erreur": "Seul l'administrateur peut supprimer un compte."}
    id_ = p.get("id") or p.get("compteId")
    compte = next((c for c in d["comptes"] if c["id"] == id_), None)
    if not compte:
        return {"erreur": "Compte introuvable."}
    if abs(float(compte.get("solde") or 0)) > 0.005:
        return {
            "erreur": "Impossible de supprimer : le solde du compte n'est pas nul. "
            "Effectuez d'abord un retrait du solde restant."
        }
    d = copy.deepcopy(d)
    d["comptes"] = [c for c in d["comptes"] if c["id"] != id_]
    d["mouvements"] = [m for m in d.get("mouvements") or [] if m.get("compteId") != id_]
    d["demandesOuvertureCompte"] = [
        {**x, "compteId": None} if x.get("compteId") == id_ else x
        for x in (d.get("demandesOuvertureCompte") or [])
    ]
    return (None, d, {})


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
    date = _horodate_caisse_agence(d, u.get("agenceId"))
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
    date = _horodate_caisse_agence(d, u.get("agenceId"))
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


def purger_journal_audit(d, u, p):
    """Admin : vide le journal des connexions. Les transactions métier restent intactes."""
    if not _est_admin(u):
        return {"erreur": "Seul l'administrateur peut purger le journal d'audit."}
    journal = d.get("journalConnexions") or []
    if not journal:
        return {"erreur": "Le journal des connexions est déjà vide."}
    d = copy.deepcopy(d)
    d["journalConnexions"] = []
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
    if cible.get("role") == "chef_agence":
        return {"erreur": "Le chef d'agence n'a pas de caisse."}
    if not _employe_a_compte_caisse(cible["role"]):
        return {"erreur": "Cet employe n'a pas de compte caisse."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez alimenter que les caisses de votre agence."}
    d, compte = _compte_caisse_operateur(copy.deepcopy(d), cible["id"], cible["agenceId"])
    if not compte:
        return {"erreur": "Compte caisse introuvable."}
    date = _horodate_caisse_agence(d, cible["agenceId"])
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


def geler_compte_caisse(d, u, p):
    """Admin : remet le solde de la caisse à zéro (retrait des espèces du compte)."""
    if not _est_admin(u):
        return {"erreur": "Seul l'administrateur peut geler une caisse."}
    employe_id = p.get("employeId") or p.get("cibleEmployeId")
    motif = (p.get("motif") or p.get("note") or "").strip()
    if not employe_id:
        return {"erreur": "Caissier non precise."}
    if not motif:
        return {"erreur": "Indiquez le motif du gel."}
    cible = next((e for e in d["employes"] if e["id"] == employe_id and e.get("actif")), None)
    if not cible:
        return {"erreur": "Employe introuvable."}
    if cible.get("role") == "chef_agence":
        return {"erreur": "Le chef d'agence n'a pas de caisse."}
    d, compte = _compte_caisse_operateur(copy.deepcopy(d), cible["id"], cible["agenceId"])
    if not compte:
        return {"erreur": "Compte caisse introuvable."}
    solde = float(compte.get("solde") or 0)
    if abs(solde) < 0.005:
        return {"erreur": "Le solde de cette caisse est déjà à zéro."}
    if _journee_caisse_en_cours(d, cible["agenceId"]):
        return {"erreur": "Clôturez ou annulez d'abord la journée ouverte avant de geler la caisse."}
    montant = abs(solde)
    date = M.maintenant()
    mouvement = {
        "id": uid(),
        "compteCaisseId": compte["id"],
        "employeId": cible["id"],
        "type": "gel",
        "montant": montant,
        "sens": "debit" if solde > 0 else "credit",
        "soldeApres": 0.0,
        "date": date,
        "description": f"Gel de caisse — solde remis à zéro ({motif})",
        "operateurId": u["id"],
        "operateurNom": u["nomComplet"],
    }
    d["mouvementsCompteCaisse"] = [mouvement, *d["mouvementsCompteCaisse"]]
    d["comptesCaisse"] = [{**c, "solde": 0.0} if c["id"] == compte["id"] else c for c in d["comptesCaisse"]]
    return (None, d, {"soldeAvant": solde})


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
    if cible.get("role") == "chef_agence":
        return {"erreur": "Le chef d'agence n'a pas de caisse. Ouvrez la caisse unique de l'agence (caissier)."}
    if not _employe_a_compte_caisse(cible["role"]):
        return {"erreur": "Cet employe n'a pas de compte caisse."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez ouvrir que les caisses de votre agence."}
    d = copy.deepcopy(d)
    if M.ouverture_caisse_agence(d.get("ouverturesCaisse") or [], cible["agenceId"], jour):
        return {"erreur": f"La journee du {jour} est deja ouverte."}
    if M.arret_caisse_agence(d["arretsCaisse"], cible["agenceId"], jour):
        return {"erreur": f"La journee du {jour} est deja cloturee."}
    auj = M.aujourd_hui_iso()
    if jour > auj:
        return {"erreur": "Impossible d'ouvrir une journee future."}
    if jour < auj:
        retards = M.journees_caisse_en_retard(
            cible["id"],
            d["transactions"],
            d["arretsCaisse"],
            d.get("ouverturesCaisse") or [],
            auj,
            d.get("employes") or [],
        )
        if jour not in retards:
            return {"erreur": "Seule la journee en cours (ou une journee passee jamais ouverte) peut etre ouverte."}
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
    d, compte = _compte_caisse_operateur(d, cible["id"], cible["agenceId"])
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
            "date": M.horodater_sur_jour(jour),
            "journee": jour,
            "description": f"Ouverture de caisse — solde saisi {solde_ouverture} FCFA",
            "operateurId": u["id"],
            "operateurNom": u["nomComplet"],
        }
        d["comptesCaisse"] = [
            {**c, "solde": solde_ouverture} if c["id"] == compte["id"] else c for c in d["comptesCaisse"]
        ]
        d["mouvementsCompteCaisse"] = [mouvement, *d["mouvementsCompteCaisse"]]
    return (None, d, {})


def _txs_caisse_du_jour(d: dict, agence_id: str, jour: str) -> list[dict]:
    """Opérations de la journée, plus celles datées aujourd'hui si c'est la seule caisse ouverte."""
    op_ids = M.operateurs_caisse_agence(d.get("employes") or [], agence_id)
    auj = M.aujourd_hui_iso()
    autres_ouvertes = {
        o["journee"]
        for o in (d.get("ouverturesCaisse") or [])
        if o.get("agenceId") == agence_id
        and o.get("journee")
        and o.get("journee") != jour
        and not M.arret_caisse_agence(d.get("arretsCaisse") or [], agence_id, o["journee"])
    }
    inclure_aujourdhui = auj not in autres_ouvertes and jour != auj
    out = []
    for t in d.get("transactions") or []:
        if t.get("annulee"):
            continue
        if not M.est_operation_caisse(t.get("type") or ""):
            continue
        if not (t.get("agenceId") == agence_id or t.get("operateurId") in op_ids):
            continue
        tj = M.jour_iso_depuis_date(t.get("date") or "")
        if tj == jour or (inclure_aujourdhui and tj == auj):
            out.append(t)
    return out


def annuler_ouverture_journee_caisse(d, u, p):
    """Annule l'ouverture et recule toutes les opérations de caisse du jour (agence)."""
    if not _est_admin(u) and not _est_chef(u):
        return {"erreur": "Seul l'administrateur ou le chef d'agence peut annuler une ouverture de journée."}
    employe_id = p["employeId"]
    jour = p.get("journee") or M.aujourd_hui_iso()
    cible = next((e for e in d["employes"] if e["id"] == employe_id and e.get("actif")), None)
    if not cible:
        return {"erreur": "Employe introuvable."}
    if cible.get("role") == "chef_agence":
        return {"erreur": "Le chef d'agence n'a pas de caisse."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez annuler que les caisses de votre agence."}
    agence_id = cible["agenceId"]
    ouverture = M.ouverture_caisse_agence(d.get("ouverturesCaisse") or [], agence_id, jour)
    if not ouverture:
        return {"erreur": f"Aucune ouverture de journée pour le {jour}."}
    if M.arret_caisse_agence(d["arretsCaisse"], agence_id, jour):
        return {"erreur": "Impossible d'annuler : la journée est déjà clôturée."}

    d = copy.deepcopy(d)
    txs = _txs_caisse_du_jour(d, agence_id, jour)
    jours = {jour} | {M.jour_iso_depuis_date(t.get("date") or "") for t in txs}
    jours.discard("")
    types_tontine = {
        "mise_tontine",
        "commission_tontine",
        "complement_mise",
        "retrait_tontine",
        "vente_carnet",
    }
    for tx in txs:
        if tx.get("type") not in types_tontine:
            continue
        client = next((c for c in d["clients"] if c["id"] == tx.get("clientId")), None)
        zone_id = (client or {}).get("zoneId")
        if not zone_id:
            ca = next(
                (
                    x
                    for x in d.get("carnets") or []
                    if x.get("clientId") == tx.get("clientId")
                    and M.jour_iso_depuis_date(x.get("dateOuverture") or "") in jours
                ),
                None,
            )
            zone_id = (ca or {}).get("zoneId")
        jz = M.journee_zone_du_jour(d.get("journeesCompteZone") or [], zone_id, jour) if zone_id else None
        if jz and jz.get("cloturee"):
            return {
                "erreur": "Impossible d'annuler : une journée zone tontine de cette date est déjà clôturée."
            }

    tx_ids = {t["id"] for t in txs}
    carnets_agence = {c["id"] for c in d.get("carnets") or [] if c.get("agenceId") == agence_id}

    # Compléments de mise : rétablir l'ancienne mise (plus récent d'abord)
    complements = sorted(
        [t for t in txs if t.get("type") == "complement_mise"],
        key=lambda t: t.get("date") or "",
        reverse=True,
    )
    for tx in complements:
        m = re.search(
            r"Complement mise\s+(\d+)\s*(?:→|->)\s*(\d+)",
            tx.get("description") or "",
            re.IGNORECASE,
        )
        if not m:
            continue
        ancienne = int(m.group(1))
        montant_tx = float(tx.get("montant") or 0)
        mise_comp = next(
            (
                mi
                for mi in d.get("mises") or []
                if mi.get("carnetId") in carnets_agence
                and M.jour_iso_depuis_date(mi.get("date") or "") in jours
                and int(mi.get("nombreMises") or 0) == 0
                and abs(float(mi.get("montant") or 0) - montant_tx) < 0.005
            ),
            None,
        )
        cid = (mise_comp or {}).get("carnetId")
        if cid:
            d["carnets"] = [
                {**c, "mise": float(ancienne)} if c["id"] == cid else c for c in d["carnets"]
            ]

    # Clôtures anticipées du jour (avec retrait = opération de caisse, sans retrait = ligne à 0 F) :
    # le cycle est rouvert (les mises d'une clôture avec retrait sont restituées ci-dessous)
    op_ids = M.operateurs_caisse_agence(d.get("employes") or [], agence_id)
    clotures_sans_retrait = [
        t
        for t in d.get("transactions") or []
        if t.get("type") == "cloture_cycle"
        and not t.get("annulee")
        and (t.get("agenceId") == agence_id or t.get("operateurId") in op_ids)
        and M.jour_iso_depuis_date(t.get("date") or "") in jours
    ]
    for tx in [*txs, *clotures_sans_retrait]:
        infos = _infos_cloture_tx(tx)
        if not infos:
            continue
        numero, cycle_clos = infos
        ca = next(
            (c for c in d["carnets"] if c.get("clientId") == tx.get("clientId") and c.get("numero") == numero),
            None,
        )
        if not ca:
            continue
        d["carnets"] = [
            {**c, "cyclesClotures": [x for x in (c.get("cyclesClotures") or []) if int(x) != cycle_clos]}
            if c["id"] == ca["id"]
            else c
            for c in d["carnets"]
        ]
        d = _recalculer_cycle_actuel_carnet(d, ca["id"])

    # Mises tontine du jour (agence)
    mises_gardees = [
        mi
        for mi in d.get("mises") or []
        if not (
            mi.get("carnetId") in carnets_agence
            and M.jour_iso_depuis_date(mi.get("date") or "") in jours
        )
    ]
    carnets_touches = {
        mi.get("carnetId")
        for mi in d.get("mises") or []
        if mi.get("carnetId") in carnets_agence
        and M.jour_iso_depuis_date(mi.get("date") or "") in jours
    }
    d["mises"] = mises_gardees
    for cid in carnets_touches:
        d = _recalculer_cycle_actuel_carnet(d, cid)

    # Carnets ouverts ce jour, plus aucune mise
    carnets_restants = []
    for ca in d.get("carnets") or []:
        if (
            ca.get("agenceId") == agence_id
            and M.jour_iso_depuis_date(ca.get("dateOuverture") or "") in jours
            and not any(mi.get("carnetId") == ca["id"] for mi in d.get("mises") or [])
        ):
            continue
        carnets_restants.append(ca)
    d["carnets"] = carnets_restants

    # Remboursements de crédit du jour
    credits_par_id = {c["id"]: c for c in d.get("credits") or []}
    remb_gardes = []
    credits_a_rouvrir: set[str] = set()
    for r in d.get("remboursements") or []:
        if M.jour_iso_depuis_date(r.get("date") or "") not in jours:
            remb_gardes.append(r)
            continue
        cred = credits_par_id.get(r.get("creditId") or "")
        if cred and any(
            t.get("type") == "remboursement_credit"
            and t.get("clientId") == cred.get("clientId")
            and abs(float(t.get("montant") or 0) - float(r.get("montant") or 0)) < 0.005
            for t in txs
        ):
            credits_a_rouvrir.add(cred["id"])
            continue
        remb_gardes.append(r)
    d["remboursements"] = remb_gardes
    d["credits"] = [
        {**c, "statut": "en_cours"}
        if c["id"] in credits_a_rouvrir and c.get("statut") == "rembourse"
        else c
        for c in d.get("credits") or []
    ]

    # Octrois du jour : crédit revient en attente
    d["credits"] = [
        {**c, "statut": "en_attente", "dateOctroi": None}
        if M.jour_iso_depuis_date(c.get("dateOctroi") or "") in jours
        and any(
            t.get("type") == "octroi_credit" and t.get("clientId") == c.get("clientId") for t in txs
        )
        else c
        for c in d.get("credits") or []
    ]

    # Mouvements comptes clients du jour (agence)
    clients_agence = {c["id"] for c in d.get("clients") or [] if c.get("agenceId") == agence_id}
    comptes_agence = [c for c in d.get("comptes") or [] if c.get("clientId") in clients_agence]
    ids_comptes = {c["id"] for c in comptes_agence}
    d["mouvements"] = [
        mv
        for mv in d.get("mouvements") or []
        if not (
            mv.get("compteId") in ids_comptes
            and M.jour_iso_depuis_date(mv.get("date") or "") in jours
        )
    ]
    comptes_ouverts_jour = [
        c["id"]
        for c in comptes_agence
        if M.jour_iso_depuis_date(c.get("dateOuverture") or "") in jours
    ]
    comptes_restants = []
    comptes_supprimes: set[str] = set()
    for c in d.get("comptes") or []:
        if c["id"] in comptes_ouverts_jour and not any(
            mv.get("compteId") == c["id"] for mv in d.get("mouvements") or []
        ):
            comptes_supprimes.add(c["id"])
            continue
        comptes_restants.append(c)
    d["comptes"] = comptes_restants
    for c in d["comptes"]:
        if c.get("clientId") in clients_agence:
            d = _recalculer_solde_compte_client(d, c["id"])

    d["demandesOuvertureCompte"] = [
        {
            **x,
            "statut": "en_attente",
            "dateTraitement": None,
            "compteId": None,
            "motifRefus": None,
        }
        if x.get("compteId") in comptes_supprimes
        else x
        for x in (d.get("demandesOuvertureCompte") or [])
    ]
    # Transferts et clôtures sans retrait du jour (hors caisse) : leurs effets viennent d'être retirés ci-dessus
    transferts_ids = {
        t["id"]
        for t in d.get("transactions") or []
        if t.get("type") in (
            "transfert_tontine_compte", "transfert_compte_compte", "transfert_tontine_tontine",
            "transfert_compte_tontine", "cloture_cycle",
        )
        and not t.get("annulee")
        and (t.get("agenceId") == agence_id or t.get("operateurId") in op_ids)
        and M.jour_iso_depuis_date(t.get("date") or "") in jours
    }

    # Transactions du jour
    d["transactions"] = [
        t for t in d.get("transactions") or [] if t.get("id") not in tx_ids and t.get("id") not in transferts_ids
    ]

    # Mouvements de caisse du jour + recalcul du solde (somme des mouvements restants, depuis 0)
    titulaire_id = ouverture.get("employeId") or cible["id"]
    compte_caisse = M.compte_caisse_agence(d.get("comptesCaisse") or [], agence_id) or M.compte_caisse_de(
        d.get("comptesCaisse") or [], titulaire_id
    )
    if compte_caisse:
        for j in jours:
            d = _purger_mouvements_caisse_du_jour(
                d,
                compte_id=compte_caisse["id"],
                jour=j,
                tx_ids=tx_ids,
                date_ouverture=ouverture.get("dateOuverture") if j == jour else None,
            )
        restants_tx = {t["id"] for t in d.get("transactions") or []}
        d["mouvementsCompteCaisse"] = [
            m
            for m in (d.get("mouvementsCompteCaisse") or [])
            if not (
                m.get("compteCaisseId") == compte_caisse["id"]
                and m.get("transactionId")
                and m.get("transactionId") not in restants_tx
            )
        ]
        d = _recalculer_solde_compte_caisse(d, titulaire_id, 0.0)

    d["ouverturesCaisse"] = [
        o
        for o in (d.get("ouverturesCaisse") or [])
        if not (o.get("agenceId") == agence_id and o.get("journee") == jour)
    ]

    nb_ops = len(txs) + len(transferts_ids)
    return (
        None,
        d,
        {
            "operationsAnnulees": nb_ops,
            "comptesAnnules": len(comptes_supprimes),
        },
    )


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
    if cible.get("role") == "chef_agence":
        return {"erreur": "Le chef d'agence n'a pas de caisse."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez arreter que les caisses de votre agence."}
    d = copy.deepcopy(d)
    if M.arret_caisse_agence(d["arretsCaisse"], cible["agenceId"], jour):
        return {"erreur": f"La caisse du {jour} est deja arretee."}
    ouverture = M.ouverture_caisse_agence(d.get("ouverturesCaisse") or [], cible["agenceId"], jour)
    if not ouverture:
        return {"erreur": f"Ouvrez d'abord la journee du {jour}."}
    auj = M.aujourd_hui_iso()
    if jour > auj:
        return {"erreur": "Impossible de cloturer une journee future."}
    sit = M.situation_caisse(
        cible["id"],
        d["transactions"],
        d["arretsCaisse"],
        jour,
        d["comptesCaisse"],
        d["mouvementsCompteCaisse"],
        d.get("ouverturesCaisse") or [],
        d.get("employes") or [],
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
        # Historique des réouvertures de cette journée (conservé sur le nouvel arrêt)
        "corrections": [c for c in (ouverture.get("corrections") or []) if c.get("type") == "reouverture"],
    }
    d["arretsCaisse"] = [arret, *d["arretsCaisse"]]
    d, compte = _compte_caisse_operateur(d, cible["id"], cible["agenceId"])
    if compte:
        cm = float(compte.get("cumulManquant") or 0)
        cs = float(compte.get("cumulSurplus") or 0)
        if ecart < 0:
            cm += abs(ecart)
        if ecart > 0:
            cs += ecart
        d["comptesCaisse"] = [
            {**c, "cumulManquant": cm, "cumulSurplus": cs} if c["id"] == compte["id"] else c
            for c in d["comptesCaisse"]
        ]
        if abs(ecart) >= 0.005:
            titulaire = compte.get("employeId") or cible["id"]
            # Ajustement daté du jour clôturé (fin de journée si arrêt en retard) : la caisse
            # de ce jour finit au montant compté ; l'ouverture suivante éventuelle est préservée.
            date_ajust = now if jour == auj else _fin_de_journee(jour)
            d = _poser_mouvement_caisse(
                d,
                existant=None,
                compte=compte,
                employe_id=titulaire,
                type_="ajustement_arret",
                delta=ecart,
                date=date_ajust,
                description=(
                    f"Ajustement de fermeture — {'surplus' if ecart > 0 else 'manquant'} {int(abs(ecart))} FCFA"
                ),
                u=u,
            )
            d = _preserver_ouverture_suivante(
                d, compte=compte, employe_id=titulaire, agence_id=cible["agenceId"], jour=jour,
                delta_solde=ecart, date_effet=date_ajust, u=u,
            )
            d = _recalculer_solde_compte_caisse(d, titulaire, 0.0)
    return (None, d, {})


def annuler_cloture_caisse(d, u, p):
    """Annule clôture + toutes les opérations du jour, puis retire l'ouverture."""
    if not _est_admin(u) and not _est_chef(u):
        return {"erreur": "Seul l'administrateur ou le chef d'agence peut annuler une clôture."}
    cible_id = p.get("cibleEmployeId") or p.get("employeId")
    jour = p.get("journee") or M.aujourd_hui_iso()
    if not cible_id:
        return {"erreur": "Caissier non precise."}
    cible = next((e for e in d["employes"] if e["id"] == cible_id and e.get("actif")), None)
    if not cible:
        return {"erreur": "Employe introuvable."}
    if cible.get("role") == "chef_agence":
        return {"erreur": "Le chef d'agence n'a pas de caisse."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez annuler que les caisses de votre agence."}
    d = copy.deepcopy(d)
    arret = M.arret_caisse_agence(d.get("arretsCaisse") or [], cible["agenceId"], jour)
    if not arret:
        return {"erreur": f"La caisse du {jour} n'est pas clôturée."}
    ecart = float(arret.get("ecart") or 0)
    date_clot = (arret.get("dateCloture") or arret.get("date") or "")[:10]
    d["arretsCaisse"] = [a for a in d["arretsCaisse"] if a.get("id") != arret.get("id")]
    d, compte = _compte_caisse_operateur(d, cible["id"], cible["agenceId"])
    if compte:
        cm = float(compte.get("cumulManquant") or 0)
        cs = float(compte.get("cumulSurplus") or 0)
        if ecart < 0:
            cm = max(0.0, cm - abs(ecart))
        elif ecart > 0:
            cs = max(0.0, cs - ecart)

        def _est_ajustement_de_cet_arret(m: dict) -> bool:
            if m.get("type") != "ajustement_arret":
                return False
            if m.get("compteCaisseId") != compte["id"]:
                return False
            if abs(float(m.get("montant") or 0) - abs(ecart)) > 0.005:
                return False
            md = (m.get("date") or "")[:10]
            return md == date_clot or md == jour

        d["mouvementsCompteCaisse"] = [
            m for m in (d.get("mouvementsCompteCaisse") or []) if not _est_ajustement_de_cet_arret(m)
        ]
        d["comptesCaisse"] = [
            {**c, "cumulManquant": cm, "cumulSurplus": cs} if c["id"] == compte["id"] else c
            for c in d["comptesCaisse"]
        ]
        d = _recalculer_solde_compte_caisse(d, cible["id"], 0.0)

    for z in d.get("zones") or []:
        if z.get("agenceId") == cible["agenceId"]:
            _rouvrir_journee_zone(d, z["id"], jour)

    return annuler_ouverture_journee_caisse(d, u, {"employeId": cible["id"], "journee": jour})


def rouvrir_journee_caisse(d, u, p):
    """Rouvre une journée de caisse clôturée pour un complément de saisie.

    Contrairement à « Annuler la clôture », les opérations du jour sont conservées : seul l'arrêt est
    retiré (écart ôté des cumuls, ajustement de caisse supprimé, ouverture suivante préservée).
    La journée redevient ouverte ; on la reclôture ensuite avec un nouveau comptage.
    """
    if not _est_admin(u) and not _est_chef(u):
        return {"erreur": "Seul l'administrateur ou le chef d'agence peut rouvrir une journée."}
    motif = " ".join(str(p.get("motif") or "").split())[:300]
    if not motif:
        return {"erreur": "Le motif est obligatoire."}
    cible_id = p.get("employeId") or p.get("cibleEmployeId")
    jour = str(p.get("journee") or "")[:10]
    cible = next((e for e in d["employes"] if e["id"] == cible_id), None)
    if not cible or not jour:
        return {"erreur": "Caisse ou journée non précisée."}
    if _est_chef(u) and cible["agenceId"] != u["agenceId"]:
        return {"erreur": "Vous ne pouvez rouvrir que les journées de votre agence."}
    agence_id = cible["agenceId"]
    d = copy.deepcopy(d)
    arret = M.arret_caisse_agence(d.get("arretsCaisse") or [], agence_id, jour)
    if not arret:
        return {"erreur": f"La journée du {jour} n'est pas clôturée."}
    ouverture = M.ouverture_caisse_agence(d.get("ouverturesCaisse") or [], agence_id, jour)
    if not ouverture:
        return {"erreur": f"Aucune ouverture de caisse le {jour} : utilisez « Annuler la clôture »."}

    ecart = float(arret.get("ecart") or 0)
    d["arretsCaisse"] = [a for a in d["arretsCaisse"] if a.get("id") != arret.get("id")]
    d, compte = _compte_caisse_operateur(d, cible["id"], agence_id)
    if compte:
        titulaire = compte.get("employeId") or cible["id"]
        cm = float(compte.get("cumulManquant") or 0)
        cs = float(compte.get("cumulSurplus") or 0)
        if ecart < 0:
            cm = max(0.0, cm - abs(ecart))
        elif ecart > 0:
            cs = max(0.0, cs - ecart)
        d["comptesCaisse"] = [
            {**c, "cumulManquant": cm, "cumulSurplus": cs} if c["id"] == compte["id"] else c
            for c in d["comptesCaisse"]
        ]
        mv = _mouvement_ajustement_arret(d, compte["id"], arret)
        if mv:
            valeur = _delta_mouvement_caisse(mv)
            d["mouvementsCompteCaisse"] = [m for m in d["mouvementsCompteCaisse"] if m["id"] != mv["id"]]
            d = _preserver_ouverture_suivante(
                d, compte=compte, employe_id=titulaire, agence_id=agence_id, jour=jour,
                delta_solde=-valeur, date_effet=mv.get("date") or "", u=u,
            )
        d = _recalculer_solde_compte_caisse(d, titulaire, 0.0)

    historique = {
        "type": "reouverture",
        "date": M.maintenant(),
        "parId": u["id"],
        "parNom": u["nomComplet"],
        "motif": motif,
        "ouvertureAvant": float(ouverture.get("soldeOuverture") or 0),
        "ouvertureApres": float(ouverture.get("soldeOuverture") or 0),
        "compteAvant": float(arret.get("montantCompte") or 0),
        "theoriqueAvant": float(arret.get("soldeTheorique") or 0),
        "ecartAvant": ecart,
    }
    d["ouverturesCaisse"] = [
        {**o, "corrections": [*(o.get("corrections") or []), historique]} if o.get("id") == ouverture.get("id") else o
        for o in d["ouverturesCaisse"]
    ]
    return (None, d, {"journee": jour})


def _delta_mouvement_caisse(m: dict | None) -> float:
    if not m:
        return 0.0
    mt = float(m.get("montant") or 0)
    return mt if m.get("sens") == "credit" else -mt


def _mouvement_ouverture_du_jour(d: dict, compte_id: str, jour: str) -> dict | None:
    return next(
        (
            m
            for m in d.get("mouvementsCompteCaisse") or []
            if m.get("compteCaisseId") == compte_id
            and m.get("type") == "ouverture_journee"
            and (m.get("date") or "")[:10] == jour
        ),
        None,
    )


def _mouvement_ajustement_arret(d: dict, compte_id: str, arret: dict) -> dict | None:
    """Ajustement créé par cet arrêt : même horodatage que la clôture, sinon même montant et même jour."""
    mvts = [
        m
        for m in d.get("mouvementsCompteCaisse") or []
        if m.get("compteCaisseId") == compte_id and m.get("type") == "ajustement_arret"
    ]
    date_clot = arret.get("dateCloture") or arret.get("date") or ""
    fin_jour = _fin_de_journee(arret.get("journee") or date_clot[:10])
    exact = next((m for m in mvts if m.get("date") in (date_clot, fin_jour)), None)
    if exact:
        return exact
    ecart = abs(float(arret.get("ecart") or 0))
    if ecart < 0.005:
        return None
    jours = {date_clot[:10], arret.get("journee")}
    return next(
        (
            m
            for m in mvts
            if abs(float(m.get("montant") or 0) - ecart) < 0.005 and (m.get("date") or "")[:10] in jours
        ),
        None,
    )


def _poser_mouvement_caisse(
    d: dict, *, existant: dict | None, compte: dict, employe_id: str, type_: str,
    delta: float, date: str, description: str, u: dict,
) -> dict:
    """Crée, met à jour ou supprime (delta nul) un ajustement de caisse pour qu'il vaille `delta`."""
    autres = [m for m in d.get("mouvementsCompteCaisse") or [] if not existant or m["id"] != existant["id"]]
    if abs(delta) < 0.005:
        d["mouvementsCompteCaisse"] = autres
        return d
    base = existant or {
        "id": uid(),
        "compteCaisseId": compte["id"],
        "employeId": employe_id,
        "type": type_,
        "date": date,
        "soldeApres": 0,
        "transactionId": None,
        "operateurId": u["id"],
        "operateurNom": u["nomComplet"],
    }
    d["mouvementsCompteCaisse"] = [
        {**base, "montant": abs(delta), "sens": "credit" if delta > 0 else "debit", "description": description},
        *autres,
    ]
    return d


def _fin_de_journee(jour: str) -> str:
    """Horodatage d'un ajustement d'arrêt : fin du jour clôturé, avant l'ouverture du lendemain."""
    return f"{jour}T23:59:59"


def _preserver_ouverture_suivante(
    d: dict, *, compte: dict, employe_id: str, agence_id: str, jour: str, delta_solde: float, date_effet: str, u: dict
) -> dict:
    """Un mouvement daté `date_effet` change le solde de fin du `jour` de `delta_solde` : on ajuste
    l'ouverture suivante de l'agence pour que son solde saisi (et donc les journées suivantes) ne bouge
    pas. Rien à faire si aucune journée n'a été ouverte depuis, si le mouvement est daté après cette
    ouverture (ex. ajustement d'une ancienne clôture en retard), ou si la caisse a été remise à zéro
    (gel) entre-temps."""
    if abs(delta_solde) < 0.005:
        return d
    suivante = min(
        (o for o in d.get("ouverturesCaisse") or [] if o.get("agenceId") == agence_id and (o.get("journee") or "") > jour),
        key=lambda o: o["journee"],
        default=None,
    )
    if not suivante:
        return d
    mv = _mouvement_ouverture_du_jour(d, compte["id"], suivante["journee"])
    # Position de l'ouverture suivante dans la chronologie de la caisse
    date_ouv_suiv = suivante.get("dateOuverture") or ""
    horodatage_suivante = (mv or {}).get("date") or (
        date_ouv_suiv if date_ouv_suiv[:10] == suivante["journee"] else f"{suivante['journee']}T00:00:00"
    )
    if (date_effet or "") >= horodatage_suivante:
        return d
    if any(
        m.get("compteCaisseId") == compte["id"]
        and m.get("type") == "gel"
        and (m.get("date") or "")[:10] > jour
        and (m.get("date") or "")[:10] <= suivante["journee"]
        for m in d.get("mouvementsCompteCaisse") or []
    ):
        return d
    return _poser_mouvement_caisse(
        d,
        existant=mv,
        compte=compte,
        employe_id=employe_id,
        type_="ouverture_journee",
        delta=_delta_mouvement_caisse(mv) - delta_solde,
        date=horodatage_suivante,
        description=f"Ouverture de caisse — solde saisi {int(float(suivante.get('soldeOuverture') or 0))} FCFA",
        u=u,
    )


def corriger_journee_caisse(d, u, p):
    """Admin : corrige le solde d'ouverture et/ou le montant compté (fermeture) d'une journée de caisse.

    Les opérations du jour ne changent pas. Théorique, écart et cumuls manquant / surplus sont
    recalculés ; les ajustements de caisse (ouverture du jour, arrêt, ouverture suivante) sont remis
    en cohérence pour que le solde des journées suivantes ne bouge pas ; la correction est historisée.
    Journée encore ouverte : seule l'ouverture peut être corrigée.
    """
    if not _est_admin(u):
        return {"erreur": "Seul l'administrateur peut corriger une journée de caisse."}
    motif = " ".join(str(p.get("motif") or "").split())[:300]
    if not motif:
        return {"erreur": "Le motif est obligatoire."}
    cible_id = p.get("employeId") or p.get("cibleEmployeId")
    jour = str(p.get("journee") or "")[:10]
    if not cible_id or not jour:
        return {"erreur": "Caisse ou journée non précisée."}
    cible = next((e for e in d["employes"] if e["id"] == cible_id), None)
    if not cible:
        return {"erreur": "Employe introuvable."}
    agence_id = cible["agenceId"]

    def _montant(cle: str) -> float | None:
        v = p.get(cle)
        if v is None or v == "":
            return None
        v = float(v)
        if v < 0:
            raise ValueError
        return v

    try:
        saisie_ouv = _montant("soldeOuverture")
        saisie_compte = _montant("montantCompte")
    except (TypeError, ValueError):
        return {"erreur": "Montant invalide."}

    d = copy.deepcopy(d)
    ouverture = M.ouverture_caisse_agence(d.get("ouverturesCaisse") or [], agence_id, jour)
    if not ouverture:
        return {"erreur": f"Aucune ouverture de caisse le {jour}."}
    arret = M.arret_caisse_agence(d.get("arretsCaisse") or [], agence_id, jour)
    if saisie_compte is not None and not arret:
        return {"erreur": "La journée n'est pas clôturée : il n'y a pas de montant compté à corriger."}

    o_old = float(ouverture.get("soldeOuverture") or 0)
    o_new = o_old if saisie_ouv is None else saisie_ouv
    delta_ouv = o_new - o_old
    c_old = float(arret.get("montantCompte") or 0) if arret else 0.0
    c_new = c_old if saisie_compte is None else saisie_compte
    delta_c = c_new - c_old
    if abs(delta_ouv) < 0.005 and abs(delta_c) < 0.005:
        return {"erreur": "Aucun changement : les montants sont identiques."}

    d, compte = _compte_caisse_operateur(d, cible["id"], agence_id)
    if not compte:
        return {"erreur": "Compte caisse introuvable."}
    titulaire = compte.get("employeId") or cible["id"]
    now = M.maintenant()
    correction = {
        "date": now,
        "parId": u["id"],
        "parNom": u["nomComplet"],
        "motif": motif,
        "ouvertureAvant": o_old,
        "ouvertureApres": o_new,
    }

    # 1. Ajustement d'ouverture du jour : la caisse démarre au nouveau solde saisi
    if abs(delta_ouv) >= 0.005:
        mv = _mouvement_ouverture_du_jour(d, compte["id"], jour)
        date_ouv = (mv or {}).get("date") or f"{jour}T00:00:00"
        d = _poser_mouvement_caisse(
            d,
            existant=mv,
            compte=compte,
            employe_id=titulaire,
            type_="ouverture_journee",
            delta=_delta_mouvement_caisse(mv) + delta_ouv,
            date=date_ouv,
            description=f"Ouverture de caisse — solde saisi {int(o_new)} FCFA (corrigé)",
            u=u,
        )
        d = _preserver_ouverture_suivante(
            d, compte=compte, employe_id=titulaire, agence_id=agence_id, jour=jour,
            delta_solde=delta_ouv, date_effet=date_ouv, u=u,
        )

    if arret:
        t_old = float(arret.get("soldeTheorique") or 0)
        t_new = t_old + delta_ouv
        e_old = float(arret.get("ecart") or 0)
        e_new = c_new - t_new
        correction.update(
            {
                "compteAvant": c_old,
                "compteApres": c_new,
                "theoriqueAvant": t_old,
                "theoriqueApres": t_new,
                "ecartAvant": e_old,
                "ecartApres": e_new,
            }
        )

        # 2. Ajustement d'arrêt : ramène la caisse au montant compté
        mv = _mouvement_ajustement_arret(d, compte["id"], arret)
        valeur = _delta_mouvement_caisse(mv) + (e_new - e_old)
        date_ajust = (mv or {}).get("date") or _fin_de_journee(jour)
        d = _poser_mouvement_caisse(
            d,
            existant=mv,
            compte=compte,
            employe_id=titulaire,
            type_="ajustement_arret",
            delta=valeur,
            date=date_ajust,
            description=(
                f"Ajustement de fermeture — {'surplus' if valeur > 0 else 'manquant'} {int(abs(valeur))} FCFA (corrigé)"
            ),
            u=u,
        )

        # 3. Ouverture suivante : son solde saisi ne change pas (sauf remise à zéro entre-temps)
        d = _preserver_ouverture_suivante(
            d, compte=compte, employe_id=titulaire, agence_id=agence_id, jour=jour,
            delta_solde=e_new - e_old, date_effet=date_ajust, u=u,
        )

        # 4. Cumuls manquant / surplus : on retire l'ancien écart, on ajoute le nouveau
        cm = float(compte.get("cumulManquant") or 0)
        cs = float(compte.get("cumulSurplus") or 0)
        if e_old < 0:
            cm = max(0.0, cm - abs(e_old))
        elif e_old > 0:
            cs = max(0.0, cs - e_old)
        if e_new < 0:
            cm += abs(e_new)
        elif e_new > 0:
            cs += e_new
        d["comptesCaisse"] = [
            {**c, "cumulManquant": cm, "cumulSurplus": cs} if c["id"] == compte["id"] else c
            for c in d["comptesCaisse"]
        ]

        # 5. Arrêt mis à jour + historique
        d["arretsCaisse"] = [
            {
                **a,
                "soldeOuverture": o_new,
                "soldeTheorique": t_new,
                "montantCompte": c_new,
                "ecart": e_new,
                "corrections": [*(a.get("corrections") or []), correction],
            }
            if a.get("id") == arret.get("id")
            else a
            for a in d["arretsCaisse"]
        ]

    if abs(delta_ouv) >= 0.005:
        d["ouverturesCaisse"] = [
            {**o, "soldeOuverture": o_new, "corrections": [*(o.get("corrections") or []), correction]}
            if o.get("id") == ouverture.get("id")
            else o
            for o in d["ouverturesCaisse"]
        ]

    d = _recalculer_solde_compte_caisse(d, titulaire, 0.0)
    return (None, d, {"correction": correction})


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
    compte = M.compte_caisse_pour_employe(d["comptesCaisse"], employe_id, d.get("employes") or [])
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


TYPES_TX_MODIFIABLES = {
    "depot_compte",
    "retrait_compte",
    "mise_tontine",
    "retrait_tontine",
    "commission_tontine",
    "complement_mise",
    "remboursement_credit",
    "part_sociale",
    "droit_adhesion",
    "transfert_tontine_compte",
    "transfert_compte_compte",
}

TYPES_TX_ANNULABLES = TYPES_TX_MODIFIABLES | {
    "vente_carnet",
    "cloture_cycle",
    # Transferts vers la tontine : annulables (pas de correction de montant : annuler puis refaire)
    "transfert_tontine_tontine",
    "transfert_compte_tontine",
}


def _numero_compte_depuis_description(description: str) -> str | None:
    """Extrait le n° de compte (B0001) depuis dépôt, retrait, adhésion ou part sociale."""
    if not description:
        return None
    # Transfert « … → B0001 » : priorité, le motif libre en fin de description ne doit pas l'emporter
    m = re.search(r"^Transfert tontine\s+\S+\s*→\s*(B[0-9]+)", description)
    if m:
        return m.group(1)
    m = re.search(r"(?:Depot|Dépôt|Retrait|adhésion|adhesion|Part sociale(?:\s+ouverture)?)\s+(?:promo\s+)?(B[0-9]+)",
        description,
        re.IGNORECASE,
    )
    if m:
        return m.group(1)
    m = re.search(r"→\s*(B[0-9]+)", description)
    if m:
        return m.group(1)
    m = re.search(r"\b(B\d{4,})\b", description)
    return m.group(1) if m else None


def _recalculer_solde_compte_client(d: dict, compte_id: str) -> dict:
    """Recalcule le solde d'un compte courant/épargne à partir de tous ses mouvements."""
    solde = 0.0
    for mv in sorted(
        (x for x in d.get("mouvements") or [] if x.get("compteId") == compte_id),
        key=lambda x: x.get("date") or "",
    ):
        mt = float(mv.get("montant") or 0)
        if mv.get("type") == "depot":
            solde += mt
        else:
            solde -= mt
    d["comptes"] = [{**c, "solde": solde} if c["id"] == compte_id else c for c in d["comptes"]]
    return d


def _recalculer_solde_compte_caisse(d: dict, employe_id: str, solde_initial: float | None = None) -> dict:
    """Recalcule le solde. Un gel remet à zéro : seuls les mouvements après le dernier gel comptent."""
    compte = M.compte_caisse_pour_employe(d.get("comptesCaisse") or [], employe_id, d.get("employes") or [])
    if not compte:
        return d
    mvts = sorted(
        [m for m in (d.get("mouvementsCompteCaisse") or []) if m.get("compteCaisseId") == compte["id"]],
        key=lambda x: (x.get("date") or "", x.get("id") or ""),
    )

    def _delta(m: dict) -> float:
        mt = float(m.get("montant") or 0)
        sens = m.get("sens")
        if sens == "credit":
            return mt
        if sens == "debit":
            return -mt
        return mt if "entree" in (m.get("type") or "") else -mt

    solde = 0.0 if solde_initial is None else float(solde_initial)
    if not mvts:
        d["comptesCaisse"] = [
            {**c, "solde": solde} if c["id"] == compte["id"] else c for c in d["comptesCaisse"]
        ]
        return d

    dernier_gel = max((i for i, m in enumerate(mvts) if m.get("type") == "gel"), default=None)
    nouveaux = []
    for i, m in enumerate(mvts):
        if dernier_gel is not None and i == dernier_gel:
            solde = 0.0
        else:
            solde += _delta(m)
        nouveaux.append({**m, "soldeApres": solde})
    ids = {m["id"] for m in nouveaux}
    autres = [m for m in (d.get("mouvementsCompteCaisse") or []) if m.get("id") not in ids]
    d["mouvementsCompteCaisse"] = sorted(
        [*nouveaux, *autres],
        key=lambda x: (x.get("date") or "", x.get("id") or ""),
        reverse=True,
    )
    d["comptesCaisse"] = [
        {**c, "solde": solde} if c["id"] == compte["id"] else c for c in d["comptesCaisse"]
    ]
    return d


def _trouver_mouvement_compte(
    d: dict, *, compte_id: str, type_mvt: str, montant: float, date_tx: str
) -> dict | None:
    jour = (date_tx or "")[:10]
    candidats = [
        mv
        for mv in d.get("mouvements") or []
        if mv.get("compteId") == compte_id
        and mv.get("type") == type_mvt
        and abs(float(mv.get("montant") or 0) - montant) < 0.005
        and (mv.get("date") or "")[:10] == jour
    ]
    if not candidats:
        return None
    # Préférer l'égalité exacte de date ISO si plusieurs
    exact = [mv for mv in candidats if mv.get("date") == date_tx]
    return exact[0] if exact else candidats[0]


def _numero_carnet_depuis_description(description: str) -> str | None:
    """Extrait le n° carnet depuis « (carnet 010001, …) », « Abonnement carnet … » ou « Retrait 010001 x »."""
    if not description:
        return None
    m = re.search(r"carnet\s+([A-Za-z0-9]{4,})", description, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"Transfert tontine\s+([A-Za-z0-9]{4,})", description, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"Retrait\s+([A-Za-z0-9]{4,})\s+x", description, re.IGNORECASE)
    return m.group(1) if m else None


def _cycle_depuis_description(description: str) -> int | None:
    if not description:
        return None
    m = re.search(r"\(cycle\s+(\d+)", description, re.IGNORECASE)
    return int(m.group(1)) if m else None


def _recalculer_cycle_actuel_carnet(d: dict, carnet_id: str) -> dict:
    """Recalcule cycleActuel : premier cycle ni plein (31 cotisées) ni clôturé (sans plafond à 12).

    Les retraits ne comptent pas : un mois déjà payé au client ne redevient pas « en cours ».
    """
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet:
        return d
    cycle = 1
    while cycle < 500 and M.cycle_termine(carnet, d["mises"], cycle):
        cycle += 1
    d["carnets"] = [{**c, "cycleActuel": cycle} if c["id"] == carnet_id else c for c in d["carnets"]]
    return d


def _trouver_mise_tontine(
    d: dict,
    *,
    client_id: str,
    typ: str,
    montant: float,
    date_tx: str,
    description: str,
) -> tuple[dict, dict] | None:
    """Retrouve (carnet, mise) liés à une transaction tontine."""
    jour = (date_tx or "")[:10]
    cycle_hint = _cycle_depuis_description(description)
    numero_carnet = _numero_carnet_depuis_description(description)

    carnets = [c for c in d["carnets"] if c.get("clientId") == client_id]
    if numero_carnet:
        filtrés = [c for c in carnets if c.get("numero") == numero_carnet]
        if filtrés:
            carnets = filtrés

    candidats: list[tuple[dict, dict]] = []
    for carnet in carnets:
        for mi in d.get("mises") or []:
            if mi.get("carnetId") != carnet["id"]:
                continue
            # Lignes d'un transfert tontine (liées à leur transaction) : jamais confondues avec un dépôt
            if mi.get("transactionId"):
                continue
            if (mi.get("date") or "")[:10] != jour:
                continue
            if cycle_hint is not None and int(mi.get("cycle") or 0) != cycle_hint:
                continue
            if typ in ("retrait_tontine", "transfert_tontine_compte"):
                if float(mi.get("nombreMises") or 0) >= 0:
                    continue
                if abs(float(mi.get("montant") or 0) + montant) < 0.005:
                    candidats.append((carnet, mi))
            elif typ == "complement_mise":
                if float(mi.get("nombreMises") or 0) != 0:
                    continue
                if abs(float(mi.get("montant") or 0) - montant) < 0.005:
                    candidats.append((carnet, mi))
            elif typ == "commission_tontine":
                # P.C = 1re mise du cycle : ligne avec dépôts > 0 le même jour
                if float(mi.get("nombreMises") or 0) <= 0:
                    continue
                # montant P.C ≈ 1 × mise unitaire (ou montant total si dépôt d'1 carreau)
                mise_u = float(carnet.get("mise") or 0)
                if abs(float(mi.get("montant") or 0) - montant) < 0.005 or (
                    mise_u > 0 and abs(montant - mise_u) < 0.005
                ):
                    candidats.append((carnet, mi))
            else:  # mise_tontine
                if float(mi.get("nombreMises") or 0) <= 0:
                    continue
                mt = float(mi.get("montant") or 0)
                # Dépôt splité P.C + reste : la ligne mise peut valoir ancien ou ancien+PC
                mise_u = float(carnet.get("mise") or 0)
                if abs(mt - montant) < 0.005:
                    candidats.append((carnet, mi))
                elif mise_u > 0 and abs(mt - (montant + mise_u)) < 0.005:
                    # Ligne totale = P.C + reste
                    candidats.append((carnet, mi))

    if not candidats:
        return None
    if len(candidats) == 1:
        return candidats[0]
    # Préférer égalité exacte de date + montant
    for carnet, mi in candidats:
        if mi.get("date") == date_tx and abs(abs(float(mi["montant"])) - montant) < 0.005:
            return carnet, mi
    return candidats[0]


def _appliquer_correction_mise_tontine(
    d: dict, typ: str, carnet: dict, mi: dict, ancien: float, nouveau: float
) -> tuple[str | None, dict]:
    """Met à jour la ligne de mise et recalcule carreaux + cycleActuel."""
    mise_unit = float(carnet.get("mise") or 0)
    cycle = int(mi.get("cycle") or carnet.get("cycleActuel") or 1)
    par_cycle = int(carnet.get("misesParCycle") or M.CARREAUX_PAR_CYCLE)

    if typ == "complement_mise":
        d["mises"] = [{**m, "montant": nouveau} if m["id"] == mi["id"] else m for m in d["mises"]]
        d = _recalculer_cycle_actuel_carnet(d, carnet["id"])
        return None, d

    if mise_unit <= 0:
        return "Mise du carnet invalide.", d
    if abs(nouveau % mise_unit) > 1e-6:
        return f"Le nouveau montant doit être un multiple de la mise ({int(mise_unit)} FCFA).", d

    n = int(round(nouveau / mise_unit))
    if n <= 0:
        return "Nombre de carreaux invalide.", d

    # Cas dépôt splité : ligne mise = total (P.C + reste), tx corrigée = reste seul
    mt_ligne = abs(float(mi.get("montant") or 0))
    if typ == "mise_tontine" and abs(mt_ligne - (ancien + mise_unit)) < 0.005:
        # On corrige la partie « reste » : total = P.C (1) + nouveau
        n_total = 1 + n
        montant_total = mise_unit * n_total
        d["mises"] = [
            {**m, "montant": montant_total, "nombreMises": n_total} if m["id"] == mi["id"] else m
            for m in d["mises"]
        ]
    elif typ == "commission_tontine":
        # P.C = part « 1re cotisation » ; la ligne de mise peut être P.C seule ou P.C + reste.
        nb = int(mi.get("nombreMises") or 0)
        if nb <= 0:
            return "Ligne de mise invalide pour la P.C.", d
        reste = max(0, nb - 1)
        if abs(mt_ligne - ancien) < 0.005:
            # Ligne = montant de la P.C seule
            n_total = n
            montant_total = nouveau
        else:
            # Ligne = P.C + reste : on remplace la part P.C, le reste inchangé
            montant_total = nouveau + mise_unit * reste
            n_total = int(round(montant_total / mise_unit))
        if n_total <= 0:
            return "Nombre de carreaux invalide.", d
        d["mises"] = [
            {**m, "montant": montant_total, "nombreMises": n_total} if m["id"] == mi["id"] else m
            for m in d["mises"]
        ]
    elif typ in ("retrait_tontine", "transfert_tontine_compte"):
        d["mises"] = [
            {**m, "montant": -nouveau, "nombreMises": -n} if m["id"] == mi["id"] else m
            for m in d["mises"]
        ]
    else:  # mise_tontine (ligne = exactement le montant de la tx)
        d["mises"] = [
            {**m, "montant": nouveau, "nombreMises": n} if m["id"] == mi["id"] else m
            for m in d["mises"]
        ]

    # Contrôle du cycle après correction
    carnet_maj = next(c for c in d["carnets"] if c["id"] == carnet["id"])
    nets = M.carreaux_nets(carnet_maj, d["mises"], cycle)
    deposes = M.carreaux_deposes(carnet_maj, d["mises"], cycle)
    if nets < 0:
        return "Correction impossible : trop de carreaux retirés sur ce cycle.", d
    if deposes > par_cycle:
        return (
            f"Correction impossible : le cycle {cycle} dépasserait {par_cycle} carreaux cotisés "
            f"(actuellement {deposes}).",
            d,
        )

    d = _recalculer_cycle_actuel_carnet(d, carnet["id"])
    return None, d


def _trouver_compte_depot_tx(
    d: dict, *, client_id: str | None, montant: float, date_tx: str, description: str
) -> tuple[dict | None, dict | None]:
    """Retrouve (compte, mouvement dépôt) liés à une transaction créditant un compte B…."""
    numero = _numero_compte_depuis_description(description or "")
    cible = next((c for c in d["comptes"] if numero and c.get("numero") == numero), None)
    if not cible and client_id:
        for c in d["comptes"]:
            if c.get("clientId") != client_id:
                continue
            if _trouver_mouvement_compte(
                d, compte_id=c["id"], type_mvt="depot", montant=montant, date_tx=date_tx
            ):
                cible = c
                break
    if not cible and client_id:
        comptes_client = [c for c in d["comptes"] if c.get("clientId") == client_id]
        if comptes_client:
            cible = next((c for c in comptes_client if c.get("type") == "courant"), comptes_client[0])
    if not cible:
        return None, None
    mvt = _trouver_mouvement_compte(
        d, compte_id=cible["id"], type_mvt="depot", montant=montant, date_tx=date_tx
    )
    return cible, mvt


def _mouvements_transfert_compte(
    d: dict, tx: dict, montant: float
) -> tuple[str | None, dict | None, dict | None, dict | None, dict | None]:
    """(erreur, compte source, compte destinataire, mvt retrait, mvt dépôt) d'un transfert compte → compte."""
    m = re.match(r"Transfert compte\s+(B[0-9]+)\s.*?→\s*(B[0-9]+)", tx.get("description") or "")
    if not m:
        return "Comptes liés au transfert introuvables.", None, None, None, None
    source = next((c for c in d["comptes"] if c.get("numero") == m.group(1)), None)
    dest = next((c for c in d["comptes"] if c.get("numero") == m.group(2)), None)
    if not source or not dest:
        return "Compte lié au transfert introuvable (supprimé ?).", None, None, None, None
    date_tx = tx.get("date") or ""
    mv_src = _trouver_mouvement_compte(d, compte_id=source["id"], type_mvt="retrait", montant=montant, date_tx=date_tx)
    mv_dst = _trouver_mouvement_compte(d, compte_id=dest["id"], type_mvt="depot", montant=montant, date_tx=date_tx)
    if not mv_src or not mv_dst:
        return "Mouvements liés au transfert introuvables.", None, None, None, None
    return None, source, dest, mv_src, mv_dst


def _verifier_soldes_positifs(d: dict, compte_ids: list[str], action: str) -> str | None:
    for cid in compte_ids:
        c = next(x for x in d["comptes"] if x["id"] == cid)
        if float(c["solde"]) < -0.005:
            return f"{action} impossible : solde du compte {c['numero']} insuffisant."
    return None


def _journee_operation_cloturee(d: dict, tx: dict) -> bool:
    """True si la journée de caisse (agence, sinon opérateur) de la transaction est déjà clôturée."""
    jour = (tx.get("date") or "")[:10]
    if not jour:
        return False
    agence_id = tx.get("agenceId")
    if agence_id and M.arret_caisse_agence(d.get("arretsCaisse") or [], agence_id, jour):
        return True
    op_id = tx.get("operateurId")
    if op_id and M.arret_caisse_du_jour(d.get("arretsCaisse") or [], op_id, jour):
        return True
    return False


def _droit_modifier_transaction(d: dict, u: dict, tx: dict) -> str | None:
    """None si l'utilisateur peut corriger/annuler cette transaction."""
    if tx.get("annulee"):
        return "Cette transaction est déjà annulée."
    if _est_admin(u):
        return None
    if _est_chef(u):
        if tx.get("agenceId") and tx.get("agenceId") != u.get("agenceId"):
            return "Vous ne pouvez modifier que les transactions de votre agence."
    elif _est_caissier(u):
        if tx.get("operateurId") != u["id"]:
            return "Vous ne pouvez modifier que vos propres transactions."
    else:
        return "Droit insuffisant."
    err = _verif_caisse(d, u)
    if err:
        return err
    if _journee_operation_cloturee(d, tx):
        return "Impossible : la journée de caisse de cette opération est déjà clôturée."
    return None


def corriger_montant_transaction(d, u, p):
    """Corrige le montant d'une transaction et recalcule les soldes des comptes concernés."""
    tx_id = p.get("transactionId") or p.get("id")
    nouveau = float(p.get("nouveauMontant") or 0)
    motif = (p.get("motif") or "").strip()
    if nouveau <= 0:
        return {"erreur": "Nouveau montant invalide."}

    d = copy.deepcopy(d)
    tx = next((t for t in d["transactions"] if t["id"] == tx_id), None)
    if not tx:
        return {"erreur": "Transaction introuvable."}
    if tx["type"] not in TYPES_TX_MODIFIABLES:
        return {"erreur": f"Ce type d'opération ({tx['type']}) ne peut pas être modifié."}

    err_droit = _droit_modifier_transaction(d, u, tx)
    if err_droit:
        return {"erreur": err_droit}

    if _infos_cloture_tx(tx):
        return {"erreur": "Une clôture de cycle ne se corrige pas : annulez-la puis refaites-la."}

    ancien = float(tx["montant"])
    if abs(nouveau - ancien) < 0.005:
        return {"erreur": "Le montant est identique."}

    diff = nouveau - ancien
    typ = tx["type"]
    client_id = tx.get("clientId")
    date_tx = tx.get("date") or ""
    note_corr = f"[corrigé {int(ancien)}→{int(nouveau)}" + (f" — {motif}" if motif else "") + "]"

    if typ in ("retrait_compte", "retrait_tontine") and diff > 0 and not _est_admin(u):
        err2 = _verif_solde_sortie(d, u, diff)
        if err2:
            return {"erreur": err2}

    # ---- Compte client (dépôt / retrait / droit d'adhésion) ----
    compte_client_id = None
    if typ in ("depot_compte", "retrait_compte", "droit_adhesion"):
        type_mvt = "retrait" if typ == "retrait_compte" else "depot"
        numero = _numero_compte_depuis_description(tx.get("description") or "")
        cible = None
        if numero:
            cible = next((c for c in d["comptes"] if c.get("numero") == numero), None)
        if not cible and client_id:
            # Chercher via mouvement du jour
            for c in d["comptes"]:
                if c.get("clientId") != client_id:
                    continue
                if _trouver_mouvement_compte(
                    d, compte_id=c["id"], type_mvt=type_mvt, montant=ancien, date_tx=date_tx
                ):
                    cible = c
                    break
        if not cible and client_id:
            comptes_client = [c for c in d["comptes"] if c.get("clientId") == client_id]
            if typ == "droit_adhesion":
                cible = next((c for c in comptes_client if abs(float(c.get("droitAdhesion") or 0) - ancien) < 0.005), None)
            if not cible and comptes_client:
                cible = next((c for c in comptes_client if c.get("type") == "courant"), comptes_client[0])

        if not cible:
            return {"erreur": "Compte client lié à la transaction introuvable."}

        mvt = _trouver_mouvement_compte(
            d, compte_id=cible["id"], type_mvt=type_mvt, montant=ancien, date_tx=date_tx
        )
        if mvt:
            d["mouvements"] = [
                {
                    **mv,
                    "montant": nouveau,
                    "note": ((mv.get("note") or "") + " " + note_corr).strip(),
                }
                if mv["id"] == mvt["id"]
                else mv
                for mv in d["mouvements"]
            ]
        elif abs(diff) > 0.005:
            # Mouvement d'origine introuvable : enregistrer l'écart puis tout recalculer
            if type_mvt == "depot":
                adj_type = "depot" if diff > 0 else "retrait"
            else:
                adj_type = "retrait" if diff > 0 else "depot"
            d["mouvements"].append(
                {
                    "id": uid(),
                    "compteId": cible["id"],
                    "type": adj_type,
                    "montant": abs(diff),
                    "date": date_tx or M.maintenant(),
                    "note": f"Ajustement correction {note_corr}",
                }
            )

        if typ == "droit_adhesion":
            d["comptes"] = [
                {**c, "droitAdhesion": nouveau} if c["id"] == cible["id"] else c for c in d["comptes"]
            ]

        d = _recalculer_solde_compte_client(d, cible["id"])
        compte_client_id = cible["id"]
        if float(next(c for c in d["comptes"] if c["id"] == cible["id"])["solde"]) < -0.005:
            return {"erreur": "Correction impossible : solde du compte client insuffisant."}

    elif typ == "part_sociale":
        numero = _numero_compte_depuis_description(tx.get("description") or "")
        cible = next((c for c in d["comptes"] if numero and c.get("numero") == numero), None)
        if not cible and client_id:
            comptes_client = [c for c in d["comptes"] if c.get("clientId") == client_id]
            cible = next(
                (c for c in comptes_client if abs(float(c.get("partSociale") or 0) - ancien) < 0.005),
                None,
            )
            if not cible and comptes_client:
                cible = next((c for c in comptes_client if c.get("type") == "courant"), comptes_client[0])
        if not cible:
            return {"erreur": "Compte client lié à la transaction introuvable."}
        d["comptes"] = [
            {**c, "partSociale": nouveau} if c["id"] == cible["id"] else c for c in d["comptes"]
        ]
        compte_client_id = cible["id"]

    # ---- Tontine : mises + recalcul cycle ----
    elif typ in ("mise_tontine", "commission_tontine", "complement_mise", "retrait_tontine"):
        trouve = _trouver_mise_tontine(
            d,
            client_id=client_id or "",
            typ=typ,
            montant=ancien,
            date_tx=date_tx,
            description=tx.get("description") or "",
        )
        if not trouve:
            return {"erreur": "Mise / carreaux liés à la transaction introuvables."}
        carnet, mi = trouve
        err_m, d = _appliquer_correction_mise_tontine(d, typ, carnet, mi, ancien, nouveau)
        if err_m:
            return {"erreur": err_m}

    elif typ == "transfert_tontine_compte":
        trouve = _trouver_mise_tontine(
            d,
            client_id=client_id or "",
            typ=typ,
            montant=ancien,
            date_tx=date_tx,
            description=tx.get("description") or "",
        )
        if not trouve:
            return {"erreur": "Mise / carreaux liés à la transaction introuvables."}
        carnet, mi = trouve
        err_m, d = _appliquer_correction_mise_tontine(d, typ, carnet, mi, ancien, nouveau)
        if err_m:
            return {"erreur": err_m}
        cible, mvt = _trouver_compte_depot_tx(
            d,
            client_id=client_id,
            montant=ancien,
            date_tx=date_tx,
            description=tx.get("description") or "",
        )
        if not cible:
            return {"erreur": "Compte banque lié à la transaction introuvable."}
        if mvt:
            d["mouvements"] = [
                {
                    **mv,
                    "montant": nouveau,
                    "note": ((mv.get("note") or "") + " " + note_corr).strip(),
                }
                if mv["id"] == mvt["id"]
                else mv
                for mv in d["mouvements"]
            ]
        elif abs(diff) > 0.005:
            adj_type = "depot" if diff > 0 else "retrait"
            d["mouvements"].append(
                {
                    "id": uid(),
                    "compteId": cible["id"],
                    "type": adj_type,
                    "montant": abs(diff),
                    "date": date_tx or M.maintenant(),
                    "note": f"Ajustement correction {note_corr}",
                }
            )
        d = _recalculer_solde_compte_client(d, cible["id"])
        compte_client_id = cible["id"]
        if float(next(c for c in d["comptes"] if c["id"] == cible["id"])["solde"]) < -0.005:
            return {"erreur": "Correction impossible : solde du compte client insuffisant."}

    elif typ == "transfert_compte_compte":
        err_t, source, dest, mv_src, mv_dst = _mouvements_transfert_compte(d, tx, ancien)
        if err_t:
            return {"erreur": err_t}
        ids = {mv_src["id"], mv_dst["id"]}
        d["mouvements"] = [
            {**mv, "montant": nouveau, "note": ((mv.get("note") or "") + " " + note_corr).strip()}
            if mv["id"] in ids
            else mv
            for mv in d["mouvements"]
        ]
        d = _recalculer_solde_compte_client(d, source["id"])
        d = _recalculer_solde_compte_client(d, dest["id"])
        err_s = _verifier_soldes_positifs(d, [source["id"], dest["id"]], "Correction")
        if err_s:
            return {"erreur": err_s}
        compte_client_id = source["id"]

    elif typ == "remboursement_credit":
        remb = next(
            (
                r
                for r in d["remboursements"]
                if (r.get("date") or "")[:10] == date_tx[:10]
                and abs(float(r["montant"]) - ancien) < 0.005
            ),
            None,
        )
        if remb:
            d["remboursements"] = [
                {**r, "montant": nouveau} if r["id"] == remb["id"] else r for r in d["remboursements"]
            ]

    # ---- Caisse de l'opérateur : maj mouvement + recalcul complet ----
    if M.est_operation_caisse(typ) and tx.get("operateurId"):
        d, compte_caisse = _compte_caisse_operateur(d, tx["operateurId"], tx.get("agenceId"))
        titulaire = (compte_caisse or {}).get("employeId") or tx["operateurId"]
        delta_nouveau = M.delta_solde_operation_caisse(typ, nouveau)
        mvt_caisse = next(
            (m for m in (d.get("mouvementsCompteCaisse") or []) if m.get("transactionId") == tx_id),
            None,
        )
        if mvt_caisse:
            d["mouvementsCompteCaisse"] = [
                {
                    **m,
                    "montant": abs(delta_nouveau),
                    "sens": "credit" if delta_nouveau >= 0 else "debit",
                    "type": "entree_operation" if delta_nouveau >= 0 else "sortie_operation",
                    "description": ((m.get("description") or "") + " " + note_corr).strip(),
                }
                if m.get("transactionId") == tx_id
                else m
                for m in d["mouvementsCompteCaisse"]
            ]
        else:
            delta_caisse = delta_nouveau - M.delta_solde_operation_caisse(typ, ancien)
            if abs(delta_caisse) > 0.005 and compte_caisse:
                d["mouvementsCompteCaisse"] = [
                    {
                        "id": uid(),
                        "compteCaisseId": compte_caisse["id"],
                        "employeId": tx["operateurId"],
                        "type": "entree_operation" if delta_caisse > 0 else "sortie_operation",
                        "montant": abs(delta_caisse),
                        "sens": "credit" if delta_caisse > 0 else "debit",
                        "soldeApres": float(compte_caisse["solde"]) + delta_caisse,
                        "date": date_tx or M.maintenant(),
                        "description": f"Correction transaction {note_corr}",
                        "transactionId": tx_id,
                        "operateurId": u["id"],
                        "operateurNom": u["nomComplet"],
                    },
                    *d["mouvementsCompteCaisse"],
                ]
        d = _recalculer_solde_compte_caisse(d, titulaire, 0.0)
        compte_caisse = M.compte_caisse_pour_employe(
            d["comptesCaisse"], tx["operateurId"], d.get("employes") or []
        )
        if compte_caisse and float(compte_caisse["solde"]) < -0.005 and not _est_admin(u):
            return {"erreur": "Correction impossible : solde de caisse insuffisant."}

    # ---- Transaction ----
    d["transactions"] = [
        {
            **t,
            "montant": nouveau,
            "description": (t.get("description") or "") + " " + note_corr,
        }
        if t["id"] == tx_id
        else t
        for t in d["transactions"]
    ]
    return (
        None,
        d,
        {
            "ancienMontant": ancien,
            "nouveauMontant": nouveau,
            "compteId": compte_client_id,
        },
    )


def _erreur_zone_cloturee_pour_tx(d: dict, tx: dict) -> str | None:
    types_tontine = {
        "mise_tontine",
        "commission_tontine",
        "complement_mise",
        "retrait_tontine",
        "vente_carnet",
    }
    if tx.get("type") not in types_tontine:
        return None
    jour = (tx.get("date") or "")[:10]
    client = next((c for c in d["clients"] if c["id"] == tx.get("clientId")), None)
    zone_id = (client or {}).get("zoneId")
    if not zone_id:
        numero = _numero_carnet_depuis_description(tx.get("description") or "")
        ca = next(
            (x for x in d.get("carnets") or [] if numero and x.get("numero") == numero),
            None,
        )
        zone_id = (ca or {}).get("zoneId")
    jz = M.journee_zone_du_jour(d.get("journeesCompteZone") or [], zone_id, jour) if zone_id else None
    if jz and jz.get("cloturee"):
        return "Impossible d'annuler : la journée zone tontine de cette date est déjà clôturée."
    return None


def _appliquer_annulation_mise_tontine(
    d: dict, typ: str, carnet: dict, mi: dict, montant_tx: float, description: str
) -> tuple[str | None, dict]:
    """Retire ou réduit la ligne de mise liée à la transaction annulée."""
    mise_unit = float(carnet.get("mise") or 0)
    cycle = int(mi.get("cycle") or carnet.get("cycleActuel") or 1)
    par_cycle = int(carnet.get("misesParCycle") or M.CARREAUX_PAR_CYCLE)
    mt_ligne = abs(float(mi.get("montant") or 0))
    nb = int(mi.get("nombreMises") or 0)

    if typ == "complement_mise":
        m = re.search(
            r"Complement mise\s+(\d+)\s*(?:→|->)\s*(\d+)",
            description or "",
            re.IGNORECASE,
        )
        if m:
            ancienne = float(m.group(1))
            d["carnets"] = [
                {**c, "mise": ancienne} if c["id"] == carnet["id"] else c for c in d["carnets"]
            ]
        d["mises"] = [m for m in d["mises"] if m["id"] != mi["id"]]
        d = _recalculer_cycle_actuel_carnet(d, carnet["id"])
        return None, d

    if typ == "retrait_tontine" or typ == "transfert_tontine_compte":
        d["mises"] = [m for m in d["mises"] if m["id"] != mi["id"]]
        d = _recalculer_cycle_actuel_carnet(d, carnet["id"])
        return None, d

    if mise_unit <= 0:
        return "Mise du carnet invalide.", d

    if typ == "commission_tontine":
        if abs(mt_ligne - montant_tx) < 0.005 and nb <= 1:
            d["mises"] = [m for m in d["mises"] if m["id"] != mi["id"]]
        else:
            n_total = max(0, nb - 1)
            if n_total <= 0:
                d["mises"] = [m for m in d["mises"] if m["id"] != mi["id"]]
            else:
                d["mises"] = [
                    {**m, "montant": mise_unit * n_total, "nombreMises": n_total}
                    if m["id"] == mi["id"]
                    else m
                    for m in d["mises"]
                ]
    elif typ == "mise_tontine":
        if abs(mt_ligne - montant_tx) < 0.005:
            d["mises"] = [m for m in d["mises"] if m["id"] != mi["id"]]
        elif abs(mt_ligne - (montant_tx + mise_unit)) < 0.005:
            d["mises"] = [
                {**m, "montant": mise_unit, "nombreMises": 1} if m["id"] == mi["id"] else m
                for m in d["mises"]
            ]
        else:
            n_oter = int(round(montant_tx / mise_unit))
            n_total = nb - n_oter
            if n_total <= 0:
                d["mises"] = [m for m in d["mises"] if m["id"] != mi["id"]]
            else:
                d["mises"] = [
                    {**m, "montant": mise_unit * n_total, "nombreMises": n_total}
                    if m["id"] == mi["id"]
                    else m
                    for m in d["mises"]
                ]

    carnet_maj = next(c for c in d["carnets"] if c["id"] == carnet["id"])
    nets = M.carreaux_nets(carnet_maj, d["mises"], cycle)
    if nets < 0:
        return "Annulation impossible : trop de carreaux déjà retirés sur ce cycle.", d
    if M.carreaux_deposes(carnet_maj, d["mises"], cycle) > par_cycle:
        return (
            f"Annulation impossible : le cycle {cycle} dépasserait {par_cycle} carreaux cotisés.",
            d,
        )
    d = _recalculer_cycle_actuel_carnet(d, carnet["id"])
    return None, d


def annuler_transaction(d, u, p):
    """Contrepasser une transaction : recule soldes / mises / caisse, conserve la ligne au journal."""
    tx_id = p.get("transactionId") or p.get("id")
    motif = (p.get("motif") or "").strip()
    if not motif:
        return {"erreur": "Le motif d'annulation est obligatoire."}

    d = copy.deepcopy(d)
    tx = next((t for t in d["transactions"] if t["id"] == tx_id), None)
    if not tx:
        return {"erreur": "Transaction introuvable."}
    if tx["type"] not in TYPES_TX_ANNULABLES:
        return {"erreur": f"Ce type d'opération ({tx['type']}) ne peut pas être annulé."}

    err_droit = _droit_modifier_transaction(d, u, tx)
    if err_droit:
        return {"erreur": err_droit}
    if not _est_admin(u):
        err_z = _erreur_zone_cloturee_pour_tx(d, tx)
        if err_z:
            return {"erreur": err_z}

    typ = tx["type"]
    montant = float(tx["montant"] or 0)
    client_id = tx.get("clientId")
    date_tx = tx.get("date") or ""
    note_ann = f"[annulé — {motif}]"

    if typ in ("depot_compte", "retrait_compte") and typ == "depot_compte" and not _est_admin(u):
        err2 = _verif_solde_sortie(d, u, montant)
        if err2:
            return {"erreur": err2}

    # ---- Compte client ----
    if typ in ("depot_compte", "retrait_compte", "droit_adhesion"):
        type_mvt = "retrait" if typ == "retrait_compte" else "depot"
        numero = _numero_compte_depuis_description(tx.get("description") or "")
        cible = next((c for c in d["comptes"] if numero and c.get("numero") == numero), None)
        if not cible and client_id:
            for c in d["comptes"]:
                if c.get("clientId") != client_id:
                    continue
                if _trouver_mouvement_compte(
                    d, compte_id=c["id"], type_mvt=type_mvt, montant=montant, date_tx=date_tx
                ):
                    cible = c
                    break
        if not cible and client_id:
            comptes_client = [c for c in d["comptes"] if c.get("clientId") == client_id]
            if typ == "droit_adhesion":
                cible = next(
                    (c for c in comptes_client if abs(float(c.get("droitAdhesion") or 0) - montant) < 0.005),
                    None,
                )
            if not cible and comptes_client:
                cible = next((c for c in comptes_client if c.get("type") == "courant"), comptes_client[0])
        if not cible:
            return {"erreur": "Compte client lié à la transaction introuvable."}

        mvt = _trouver_mouvement_compte(
            d, compte_id=cible["id"], type_mvt=type_mvt, montant=montant, date_tx=date_tx
        )
        if mvt:
            d["mouvements"] = [mv for mv in d["mouvements"] if mv["id"] != mvt["id"]]
        if typ == "droit_adhesion":
            d["comptes"] = [{**c, "droitAdhesion": 0} if c["id"] == cible["id"] else c for c in d["comptes"]]
        d = _recalculer_solde_compte_client(d, cible["id"])
        if float(next(c for c in d["comptes"] if c["id"] == cible["id"])["solde"]) < -0.005:
            return {"erreur": "Annulation impossible : solde du compte client insuffisant."}

    elif typ == "part_sociale":
        numero = _numero_compte_depuis_description(tx.get("description") or "")
        cible = next((c for c in d["comptes"] if numero and c.get("numero") == numero), None)
        if not cible and client_id:
            comptes_client = [c for c in d["comptes"] if c.get("clientId") == client_id]
            cible = next(
                (c for c in comptes_client if abs(float(c.get("partSociale") or 0) - montant) < 0.005),
                None,
            )
            if not cible and comptes_client:
                cible = next((c for c in comptes_client if c.get("type") == "courant"), comptes_client[0])
        if not cible:
            return {"erreur": "Compte client lié à la transaction introuvable."}
        d["comptes"] = [{**c, "partSociale": 0} if c["id"] == cible["id"] else c for c in d["comptes"]]
        if not _est_admin(u):
            err2 = _verif_solde_sortie(d, u, montant)
            if err2:
                return {"erreur": err2}

    elif typ == "transfert_tontine_tontine":
        err_t, d = _annuler_mises_transfert(d, tx)
        if err_t:
            return {"erreur": err_t}

    elif typ == "transfert_compte_tontine":
        err_t, d = _annuler_mises_transfert(d, tx)
        if err_t:
            return {"erreur": err_t}
        m_num = re.match(r"Transfert compte\s+(B[0-9]+)", tx.get("description") or "")
        source = next((c for c in d["comptes"] if m_num and c.get("numero") == m_num.group(1)), None)
        if not source:
            return {"erreur": "Compte source du transfert introuvable (supprimé ?)."}
        mvt = _trouver_mouvement_compte(d, compte_id=source["id"], type_mvt="retrait", montant=montant, date_tx=date_tx)
        if not mvt:
            return {"erreur": "Mouvement du compte source introuvable."}
        d["mouvements"] = [mv for mv in d["mouvements"] if mv["id"] != mvt["id"]]
        d = _recalculer_solde_compte_client(d, source["id"])

    elif _infos_cloture_tx(tx):
        # Clôture anticipée : on rouvre le cycle (et, si elle était avec retrait, on lui rend ses mises)
        numero, cycle_clos = _infos_cloture_tx(tx)
        carnet = next(
            (c for c in d["carnets"] if c.get("clientId") == client_id and c.get("numero") == numero), None
        )
        if not carnet:
            return {"erreur": "Carnet lié à la clôture introuvable."}
        if any(
            mi.get("carnetId") == carnet["id"] and int(mi.get("cycle") or 0) > cycle_clos
            and int(mi.get("nombreMises") or 0) > 0
            for mi in d["mises"]
        ):
            return {"erreur": "Annulation impossible : des dépôts ont déjà été faits sur les cycles suivants."}
        if typ == "retrait_tontine":
            mi = next(
                (
                    x
                    for x in d["mises"]
                    if x.get("carnetId") == carnet["id"]
                    and int(x.get("cycle") or 0) == cycle_clos
                    and int(x.get("nombreMises") or 0) < 0
                    and abs(float(x.get("montant") or 0) + montant) < 0.005
                    and (x.get("date") or "")[:10] == date_tx[:10]
                ),
                None,
            )
            if not mi:
                return {"erreur": "Mises liées à la clôture introuvables."}
            d["mises"] = [x for x in d["mises"] if x["id"] != mi["id"]]
        d["carnets"] = [
            {
                **c,
                "cyclesClotures": [x for x in (c.get("cyclesClotures") or []) if int(x) != cycle_clos],
                "cycleActuel": cycle_clos,
            }
            if c["id"] == carnet["id"]
            else c
            for c in d["carnets"]
        ]

    elif typ in ("mise_tontine", "commission_tontine", "complement_mise", "retrait_tontine"):
        trouve = _trouver_mise_tontine(
            d,
            client_id=client_id or "",
            typ=typ,
            montant=montant,
            date_tx=date_tx,
            description=tx.get("description") or "",
        )
        if not trouve:
            return {"erreur": "Mise / carreaux liés à la transaction introuvables."}
        carnet, mi = trouve
        err_m, d = _appliquer_annulation_mise_tontine(
            d, typ, carnet, mi, montant, tx.get("description") or ""
        )
        if err_m:
            return {"erreur": err_m}
        if typ in ("mise_tontine", "commission_tontine", "complement_mise") and not _est_admin(u):
            err2 = _verif_solde_sortie(d, u, montant)
            if err2:
                return {"erreur": err2}

    elif typ == "transfert_tontine_compte":
        trouve = _trouver_mise_tontine(
            d,
            client_id=client_id or "",
            typ=typ,
            montant=montant,
            date_tx=date_tx,
            description=tx.get("description") or "",
        )
        if not trouve:
            return {"erreur": "Mise / carreaux liés à la transaction introuvables."}
        carnet, mi = trouve
        err_m, d = _appliquer_annulation_mise_tontine(
            d, typ, carnet, mi, montant, tx.get("description") or ""
        )
        if err_m:
            return {"erreur": err_m}
        cible, mvt = _trouver_compte_depot_tx(
            d,
            client_id=client_id,
            montant=montant,
            date_tx=date_tx,
            description=tx.get("description") or "",
        )
        if not cible:
            return {"erreur": "Compte banque lié à la transaction introuvable."}
        if mvt:
            d["mouvements"] = [mv for mv in d["mouvements"] if mv["id"] != mvt["id"]]
        d = _recalculer_solde_compte_client(d, cible["id"])
        if float(next(c for c in d["comptes"] if c["id"] == cible["id"])["solde"]) < -0.005:
            return {"erreur": "Annulation impossible : solde du compte client insuffisant."}

    elif typ == "transfert_compte_compte":
        err_t, source, dest, mv_src, mv_dst = _mouvements_transfert_compte(d, tx, montant)
        if err_t:
            return {"erreur": err_t}
        ids = {mv_src["id"], mv_dst["id"]}
        d["mouvements"] = [mv for mv in d["mouvements"] if mv["id"] not in ids]
        d = _recalculer_solde_compte_client(d, source["id"])
        d = _recalculer_solde_compte_client(d, dest["id"])
        err_s = _verifier_soldes_positifs(d, [dest["id"]], "Annulation")
        if err_s:
            return {"erreur": err_s}

    elif typ == "vente_carnet":
        if not _est_admin(u):
            err2 = _verif_solde_sortie(d, u, montant)
            if err2:
                return {"erreur": err2}

    elif typ == "remboursement_credit":
        remb = next(
            (
                r
                for r in d["remboursements"]
                if (r.get("date") or "")[:10] == date_tx[:10]
                and abs(float(r["montant"]) - montant) < 0.005
            ),
            None,
        )
        if remb:
            credit_id = remb.get("creditId")
            d["remboursements"] = [r for r in d["remboursements"] if r["id"] != remb["id"]]
            if credit_id:
                d["credits"] = [
                    {**c, "statut": "en_cours"}
                    if c["id"] == credit_id and c.get("statut") == "rembourse"
                    else c
                    for c in d["credits"]
                ]

    # ---- Caisse ----
    if M.est_operation_caisse(typ) and tx.get("operateurId"):
        d, compte_caisse = _compte_caisse_operateur(d, tx["operateurId"], tx.get("agenceId"))
        titulaire = (compte_caisse or {}).get("employeId") or tx["operateurId"]
        d["mouvementsCompteCaisse"] = [
            m
            for m in (d.get("mouvementsCompteCaisse") or [])
            if m.get("transactionId") != tx_id
        ]
        d = _recalculer_solde_compte_caisse(d, titulaire, 0.0)
        compte_caisse = M.compte_caisse_pour_employe(
            d["comptesCaisse"], tx["operateurId"], d.get("employes") or []
        )
        if compte_caisse and float(compte_caisse["solde"]) < -0.005 and not _est_admin(u):
            return {"erreur": "Annulation impossible : solde de caisse insuffisant."}

    now = M.maintenant()
    d["transactions"] = [
        {
            **t,
            "annulee": True,
            "motifAnnulation": motif,
            "dateAnnulation": now,
            "annuleParId": u["id"],
            "annuleParNom": u["nomComplet"],
            "description": (t.get("description") or "") + " " + note_ann,
        }
        if t["id"] == tx_id
        else t
        for t in d["transactions"]
    ]
    return (None, d, {"transactionId": tx_id})


ACTIONS = {
    "ajouterAgence": ajouter_agence,
    "modifierAgence": modifier_agence,
    "basculerActifAgence": basculer_actif_agence,
    "ajouterZone": ajouter_zone,
    "modifierZone": modifier_zone,
    "basculerActifZone": basculer_actif_zone,
    "saisirMontantReelZone": saisir_montant_reel_zone,
    "cloturerJourneeZone": cloturer_journee_zone,
    "annulerClotureJourneeZone": annuler_cloture_journee_zone,
    "ajusterCumulCompteZone": ajuster_cumul_compte_zone,
    "ajouterClient": ajouter_client,
    "inscrireClientBanque": inscrire_client_banque,
    "modifierClient": modifier_client,
    "basculerActifClient": basculer_actif_client,
    "supprimerClient": supprimer_client,
    "ouvrirCarnet": ouvrir_carnet,
    "encaisserCotisation": encaisser_cotisation,
    "renouvelerCarnet": renouveler_carnet,
    "changerMiseCarnet": changer_mise_carnet,
    "retraitCycle": retrait_cycle,
    "transfertTontineCompte": transfert_tontine_compte,
    "transfertCompteCompte": transfert_compte_compte,
    "transfertTontineTontine": transfert_tontine_tontine,
    "transfertCompteTontine": transfert_compte_tontine,
    "cloturerCycle": cloturer_cycle,
    "corrigerJourneeCaisse": corriger_journee_caisse,
    "rouvrirJourneeCaisse": rouvrir_journee_caisse,
    "basculerVerrouCarnet": basculer_verrou_carnet,
    "basculerRetraitCarnetAdmin": basculer_retrait_carnet_admin,
    "supprimerCarnet": supprimer_carnet,
    "ouvrirCompte": ouvrir_compte,
    "validerOuvertureCompte": valider_ouverture_compte,
    "refuserOuvertureCompte": refuser_ouverture_compte,
    "deposerCompte": deposer_compte,
    "retirerCompte": retirer_compte,
    "basculerVerrouCompte": basculer_verrou_compte,
    "supprimerCompte": supprimer_compte,
    "corrigerMontantTransaction": corriger_montant_transaction,
    "annulerTransaction": annuler_transaction,
    "demanderCredit": demander_credit,
    "approuverCredit": approuver_credit,
    "rejeterCredit": rejeter_credit,
    "rembourserCredit": rembourser_credit,
    "ajouterEmploye": ajouter_employe,
    "modifierEmploye": modifier_employe,
    "supprimerEmploye": supprimer_employe,
    "basculerActifEmploye": basculer_actif_employe,
    "purgerJournalAudit": purger_journal_audit,
    "alimenterCompteCaisse": alimenter_compte_caisse,
    "gelerCompteCaisse": geler_compte_caisse,
    "ouvrirJourneeCaisse": ouvrir_journee_caisse,
    "annulerOuvertureJourneeCaisse": annuler_ouverture_journee_caisse,
    "arreterCaisse": arreter_caisse,
    "annulerClotureCaisse": annuler_cloture_caisse,
    "regulariserCumulCompteCaisse": regulariser_cumul_compte_caisse,
    "reinitialiserDemo": lambda d, u, p: {"erreur": "handled upstream"},
}
