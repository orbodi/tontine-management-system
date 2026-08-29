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
        d["clients"].append(
            {
                "id": cid,
                "codeClient": None,
                "agenceId": agence_id,
                "zoneId": None,
                "ordreZone": None,
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
    return (None, d, {"id": cid})


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

    jour = _jour_collecte_payload(p)
    err_jour = _erreur_date_collecte(d, carnet["zoneId"], jour)
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
                            f"(cycle {cycle_depot}){note_collecte}"
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
    err = _verif_caisse(d, u)
    if err:
        return {"erreur": err}
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
    err_jour = _erreur_date_collecte(d, carnet["zoneId"], jour)
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
        err = _verif_caisse(d, u)
        if err:
            return {"erreur": err}
        jour = _jour_collecte_payload(p)
        err_jour = _erreur_date_collecte(d, carnet["zoneId"], jour)
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
    retirables = M.carreaux_retirables(carnet, d["mises"], cycle)
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
    mises = [mi for mi in d.get("mises") or [] if mi.get("carnetId") == id_]

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
    if _origine_tontine(client.get("origineTontine")) == "ancien":
        part_sociale = 0.0
        droit = 0.0
    else:
        part_sociale = float(settings.part_sociale_montant)
        droit = float(
            settings.droit_adhesion_promo_montant if promotion else settings.droit_adhesion_montant
        )
    caissier = next((e for e in d["employes"] if e["id"] == caissier_id and e.get("actif")), None)
    if not caissier or caissier.get("role") != "caissier":
        return {"erreur": "Indiquez un caissier de l'agence (le chef d'agence n'a pas de caisse)."}
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
    ids_avec_compte = {c.get("clientId") for c in d["comptes"]}
    d["clients"] = [
        {**c, "codeClientBanque": None, "ordreBanque": None}
        if c.get("agenceId") == agence_id and c["id"] not in ids_avec_compte and c.get("codeClientBanque")
        else c
        for c in d["clients"]
    ]

    # Transactions du jour
    d["transactions"] = [t for t in d.get("transactions") or [] if t.get("id") not in tx_ids]

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

    nb_ops = len(txs)
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
    }
    d["arretsCaisse"] = [arret, *d["arretsCaisse"]]
    d, compte = _compte_caisse_operateur(d, cible["id"], cible["agenceId"])
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
}


def _numero_compte_depuis_description(description: str) -> str | None:
    """Extrait le n° de compte depuis « Depot B0001 — … » / « Retrait B0001 — … »."""
    if not description:
        return None
    m = re.search(r"(?:Depot|Dépôt|Retrait)\s+([A-Za-z0-9\-]+)", description, re.IGNORECASE)
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
    if not description:
        return None
    m = re.search(r"Retrait\s+([A-Za-z0-9]+)\s+x", description, re.IGNORECASE)
    return m.group(1) if m else None


def _cycle_depuis_description(description: str) -> int | None:
    if not description:
        return None
    m = re.search(r"\(cycle\s+(\d+)", description, re.IGNORECASE)
    return int(m.group(1)) if m else None


def _recalculer_cycle_actuel_carnet(d: dict, carnet_id: str) -> dict:
    """Recalcule cycleActuel d'après les carreaux nets de chaque cycle (sans plafond à 12)."""
    carnet = next((c for c in d["carnets"] if c["id"] == carnet_id), None)
    if not carnet:
        return d
    par_cycle = int(carnet.get("misesParCycle") or M.CARREAUX_PAR_CYCLE)
    cycle = 1
    while cycle < 500 and M.carreaux_nets(carnet, d["mises"], cycle) >= par_cycle:
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
            if (mi.get("date") or "")[:10] != jour:
                continue
            if cycle_hint is not None and int(mi.get("cycle") or 0) != cycle_hint:
                continue
            if typ == "retrait_tontine":
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
    elif typ == "retrait_tontine":
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
    if nets < 0:
        return "Correction impossible : trop de carreaux retirés sur ce cycle.", d
    if nets > par_cycle:
        return (
            f"Correction impossible : le cycle {cycle} dépasserait {par_cycle} carreaux "
            f"(actuellement {nets}).",
            d,
        )

    d = _recalculer_cycle_actuel_carnet(d, carnet["id"])
    return None, d


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

    if _est_admin(u):
        pass
    elif _est_chef(u) or _est_caissier(u):
        if tx.get("operateurId") != u["id"]:
            return {"erreur": "Vous ne pouvez modifier que vos propres transactions."}
        err = _verif_caisse(d, u)
        if err:
            return {"erreur": err}
        jour_tx = (tx.get("date") or "")[:10]
        if jour_tx and M.arret_caisse_du_jour(d["arretsCaisse"], u["id"], jour_tx):
            return {"erreur": "Impossible : la journée de caisse de cette opération est déjà clôturée."}
    else:
        return {"erreur": "Droit insuffisant."}

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
    "modifierClient": modifier_client,
    "basculerActifClient": basculer_actif_client,
    "supprimerClient": supprimer_client,
    "ouvrirCarnet": ouvrir_carnet,
    "encaisserCotisation": encaisser_cotisation,
    "renouvelerCarnet": renouveler_carnet,
    "changerMiseCarnet": changer_mise_carnet,
    "retraitCycle": retrait_cycle,
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
