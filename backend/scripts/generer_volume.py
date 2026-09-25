"""Génère une base de volume (clients synthétiques) pour mesurer les performances sans données réelles.

Usage (depuis backend/) :
    python scripts/generer_volume.py --base /tmp/volume.db [--tontine 5000] [--banque 5000] [--graine 1]

- Si la base n'existe pas, elle est d'abord créée avec la démo (comme au démarrage de l'API).
- Ajoute N clients tontine (carnet + 8 à 20 jours de dépôts, proche d'une base réelle) et M clients banque (compte + 2 à 3
  mouvements), datés avant « aujourd'hui », au nom de l'administrateur, sans mouvement de caisse.
- Identifiants préfixés « gv », nom « SYNTHETIQUE ». Refuse de viser la vraie base (data/app.db).
"""
from __future__ import annotations

import argparse
import os
import random
import sys
from datetime import date, timedelta
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]


def _arguments() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=True, type=Path, help="fichier SQLite à créer ou compléter")
    p.add_argument("--tontine", type=int, default=5000, help="clients tontine à ajouter")
    p.add_argument("--banque", type=int, default=5000, help="clients banque à ajouter")
    p.add_argument("--jours-depot", default="8-20", help="jours de dépôt par client tontine (min-max)")
    p.add_argument("--graine", type=int, default=1, help="graine aléatoire (reproductible)")
    return p.parse_args()


def main() -> None:
    args = _arguments()
    base = args.base.resolve()
    if base == (RACINE / "data" / "app.db").resolve():
        raise SystemExit("Refusé : ce script ne doit jamais viser la vraie base (data/app.db).")
    os.environ["DATABASE_URL"] = f"sqlite:///{base.as_posix()}"
    os.environ["SEED_DEMO_ON_STARTUP"] = "true"
    sys.path.insert(0, str(RACINE))

    from app.db import SessionLocal
    from app.repository import load_state, replace_state
    from tests.outils import construire_base_demo

    if not base.exists():
        base.parent.mkdir(parents=True, exist_ok=True)
        construire_base_demo()
        print("Base de démo créée :", base)

    db = SessionLocal()
    d = load_state(db, include_password_hashes=True)
    for e in d["employes"]:
        e["motDePasse"] = e.pop("_passwordHash")
    if any(c["id"].startswith("gv") for c in d["clients"]):
        raise SystemExit("Cette base contient déjà des clients synthétiques : rien n'a été ajouté.")

    rnd = random.Random(args.graine)
    admin = next(e for e in d["employes"] if e["role"] == "admin" and e["actif"])
    zones = [z for z in d["zones"] if z.get("actif", True)]
    zones_code = {z["id"]: z["code"] for z in zones}
    jours_exclus = {j["date"] for j in d["journeesCompteZone"]}
    hier = date.today() - timedelta(days=1)
    ordre_zone = {
        z["id"]: max([c.get("ordreZone") or 0 for c in d["clients"] if c.get("zoneId") == z["id"]]
                     + [int(d["compteursOrdreZone"].get(z["id"], 0))])
        for z in zones
    }
    ordre_banque = max([c.get("ordreBanque") or 0 for c in d["clients"]] + [int(d["compteurs"].get("clientBanque", 0))])
    ordre_compte = max([int(c["numero"][1:]) for c in d["comptes"] if c["numero"][1:].isdigit()]
                       + [int(d["compteurs"].get("compte", 0))])

    def jours(debut: date, nombre: int) -> list[date]:
        possibles = [debut + timedelta(days=i) for i in range((hier - debut).days + 1)]
        possibles = [j for j in possibles if j.isoformat() not in jours_exclus]
        return sorted(rnd.sample(possibles, min(len(possibles), nombre)))

    def horodate(j: date) -> str:
        return f"{j.isoformat()}T{rnd.randint(8, 17):02d}:{rnd.randint(0, 59):02d}:{rnd.randint(0, 59):02d}.000000"

    def tx(type_: str, client_id: str, montant: float, quand: str, description: str, agence_id: str) -> dict:
        return {
            "id": f"gvtx{len(d['transactions']):07d}", "type": type_, "clientId": client_id, "montant": montant,
            "date": quand, "description": description, "operateur": admin["nomComplet"], "operateurId": admin["id"],
            "agenceId": agence_id, "annulee": False, "motifAnnulation": None, "dateAnnulation": None,
            "annuleParId": None, "annuleParNom": None, "clientDestinationId": None,
        }

    debut_periode = hier - timedelta(days=180)
    jmin, jmax = (int(x) for x in args.jours_depot.split("-"))

    # Clients tontine : carnet + jours de dépôts
    for i in range(1, args.tontine + 1):
        z = zones[(i - 1) % len(zones)]
        ordre_zone[z["id"]] += 1
        numero = f"{zones_code[z['id']]}{ordre_zone[z['id']]:04d}"
        cid, kid = f"gvcl{i:06d}", f"gvca{i:06d}"
        ouverture = debut_periode + timedelta(days=rnd.randint(0, 150))
        prenom = f"Client {i:05d}"
        d["clients"].append({
            "id": cid, "codeClient": numero, "agenceId": z["agenceId"], "zoneId": z["id"], "ordreZone": ordre_zone[z["id"]],
            "ordreBanque": None, "codeClientBanque": None, "nom": "SYNTHETIQUE", "prenom": prenom,
            "sexe": "M" if i % 2 else "F", "telephone": f"90{rnd.randint(0, 999999):06d}", "email": None,
            "profession": None, "adresse": None, "pieceIdentite": None,
            "dateInscription": f"{ouverture.isoformat()}T09:00:00", "actif": True, "origineTontine": "nouveau",
        })
        mise = float(rnd.choice([200, 300, 500, 1000]))
        cycle, cotise = 1, 0
        for j in jours(ouverture, rnd.randint(jmin, jmax)):
            quand, reste = horodate(j), rnd.randint(1, 4)
            while reste > 0:
                nb = min(reste, 31 - cotise)
                d["mises"].append({"id": f"gvmi{len(d['mises']):07d}", "carnetId": kid, "cycle": cycle,
                                   "nombreMises": nb, "montant": nb * mise, "date": quand, "transactionId": None})
                d["transactions"].append(tx("mise_tontine", cid, nb * mise, quand,
                                            f"Depot x{nb} — {prenom} SYNTHETIQUE (carnet {numero}, cycle {cycle})",
                                            z["agenceId"]))
                cotise += nb
                reste -= nb
                if cotise >= 31:
                    cycle, cotise = cycle + 1, 0
        d["carnets"].append({
            "id": kid, "clientId": cid, "numero": numero, "zoneId": z["id"], "agenceId": z["agenceId"],
            "typeCarnet": "tontine", "mise": mise, "frequence": "journaliere", "misesParCycle": 31,
            "cycleActuel": cycle, "dateOuverture": f"{ouverture.isoformat()}T09:00:00", "verrouille": False,
            "retraitActiveParAdmin": True, "actif": True, "reprisePapier": False, "cyclesClotures": [],
        })

    # Clients banque : compte courant / épargne + 2 à 3 mouvements
    agence = next(a["id"] for a in d["agences"] if a.get("actif", True))
    for i in range(1, args.banque + 1):
        ordre_banque += 1
        ordre_compte += 1
        cid, coid, prenom = f"gvcb{i:06d}", f"gvco{i:06d}", f"Banque {i:05d}"
        numero = f"B{ordre_compte:04d}"
        ouverture = debut_periode + timedelta(days=rnd.randint(0, 150))
        d["clients"].append({
            "id": cid, "codeClient": None, "agenceId": agence, "zoneId": None, "ordreZone": None,
            "ordreBanque": ordre_banque, "codeClientBanque": f"{ordre_banque:04d}", "nom": "SYNTHETIQUE",
            "prenom": prenom, "sexe": "M" if i % 2 else "F", "telephone": f"91{rnd.randint(0, 999999):06d}",
            "email": None, "profession": None, "adresse": None, "pieceIdentite": None,
            "dateInscription": f"{ouverture.isoformat()}T09:00:00", "actif": True, "origineTontine": "nouveau",
        })
        solde = 0.0
        for n, j in enumerate(jours(ouverture, rnd.randint(2, 3))):
            quand = horodate(j)
            retrait = n > 0 and rnd.random() < 0.35 and solde >= 1000
            montant = float(rnd.randint(1, max(1, int(solde // 2000))) * 1000) if retrait else float(rnd.randint(1, 50) * 1000)
            solde += -montant if retrait else montant
            d["mouvements"].append({"id": f"gvmv{len(d['mouvements']):07d}", "compteId": coid,
                                    "type": "retrait" if retrait else "depot", "montant": montant, "date": quand, "note": None})
            d["transactions"].append(tx("retrait_compte" if retrait else "depot_compte", cid, montant, quand,
                                        f"{'Retrait' if retrait else 'Depot'} {numero} — {prenom} SYNTHETIQUE", agence))
        d["comptes"].append({
            "id": coid, "clientId": cid, "type": "courant" if rnd.random() < 0.7 else "epargne", "numero": numero,
            "solde": solde, "dateOuverture": f"{ouverture.isoformat()}T09:00:00", "verrouille": False,
            "partSociale": 0, "droitAdhesion": 0, "promotion": False,
        })

    d["compteursOrdreZone"] = {**d["compteursOrdreZone"], **ordre_zone}
    d["compteurs"] = {**d["compteurs"], "clientBanque": ordre_banque, "compte": ordre_compte}
    replace_state(db, d, hash_plain_passwords=True)
    db.close()
    print(f"Ajouté : {args.tontine} clients tontine, {args.banque} clients banque -> "
          f"{len(d['clients'])} clients, {len(d['mises'])} mises, {len(d['transactions'])} transactions")


if __name__ == "__main__":
    main()
