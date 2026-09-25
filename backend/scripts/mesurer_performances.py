"""Mesure le coût du branchement API <-> base sur une COPIE temporaire d'une base (jamais l'originale).

Usage (depuis backend/) :
    python scripts/mesurer_performances.py --base /tmp/volume.db [--json mesures.json] [--simultanees 4]

Mesures : lecture complète, taille de la réponse (brute / compressée), réécriture complète, une action
simple de bout en bout (verrouiller un carnet), un dépôt tontine de bout en bout, et N actions
simultanées (erreurs et actions écrasées). À joindre, avant/après, à chaque pull request du chantier.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]


def _arguments() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=True, type=Path, help="base SQLite à mesurer (copiée, jamais modifiée)")
    p.add_argument("--json", type=Path, help="écrit aussi les mesures dans ce fichier JSON")
    p.add_argument("--simultanees", type=int, default=4, help="nombre d'actions simultanées")
    return p.parse_args()


def main() -> None:
    args = _arguments()
    if not args.base.is_file():
        raise SystemExit(f"Base introuvable : {args.base}")
    copie = Path(tempfile.mkdtemp(prefix="mesure-")) / "copie.db"
    shutil.copy2(args.base, copie)
    os.environ["DATABASE_URL"] = f"sqlite:///{copie.as_posix()}"
    os.environ["SEED_DEMO_ON_STARTUP"] = "false"
    sys.path.insert(0, str(RACINE))

    from app import engine as E
    from app import metier as M
    from app.db import SessionLocal
    from app.repository import load_state, replace_state

    mesures: dict[str, float | int | str] = {}

    def chrono(cle: str, libelle: str, f):
        t = time.perf_counter()
        r = f()
        mesures[cle] = round(time.perf_counter() - t, 2)
        print(f"{libelle:52} {mesures[cle]:7.2f} s")
        return r

    db = SessionLocal()
    d = chrono("lecture_complete_s", "Lecture complète (load_state)", lambda: load_state(db, include_password_hashes=True))
    mesures["lignes"] = sum(len(v) for v in d.values() if isinstance(v, list))
    brut = json.dumps(E._public(d)).encode()
    mesures["reponse_mo"] = round(len(brut) / 1e6, 1)
    mesures["reponse_gzip_mo"] = round(len(gzip.compress(brut, compresslevel=5)) / 1e6, 1)
    print(f"{'Lignes métier':52} {mesures['lignes']:7d}")
    print(f"{'Réponse complète (brute / gzip)':52} {mesures['reponse_mo']:5.1f} Mo / {mesures['reponse_gzip_mo']} Mo")
    chrono("reecriture_complete_s", "Réécriture complète (replace_state)", lambda: replace_state(db, d, hash_plain_passwords=True))

    chef = next(e for e in d["employes"] if e["role"] == "chef_agence" and e["actif"])
    admin = next(e for e in d["employes"] if e["role"] == "admin" and e["actif"])
    caissier = next(e for e in d["employes"] if e["role"] == "caissier" and e["actif"] and e["agenceId"] == chef["agenceId"])
    libres = [k for k in d["carnets"] if k["actif"] and not k["verrouille"] and k["agenceId"] == chef["agenceId"]
              and not M.besoin_renouvellement_carnet(k, d["mises"], d["transactions"])]

    def action(user, nom, payload):
        r = E.run_mutation(db, user["id"], nom, payload)
        if r.get("erreur"):
            raise SystemExit(f"{nom} refusé : {r['erreur']}")
        return r

    chrono("action_simple_s", "Action simple de bout en bout (verrouiller un carnet)",
           lambda: action(admin, "basculerVerrouCarnet", {"id": libres[-1]["id"]}))

    # Dépôt tontine du jour : caisse ouverte et montant réel saisi si besoin
    auj = M.aujourd_hui_iso()
    d = load_state(db)
    k = libres[0]
    if not M.ouverture_caisse_agence(d["ouverturesCaisse"], chef["agenceId"], auj):
        compte = M.compte_caisse_agence(d["comptesCaisse"], chef["agenceId"])
        action(chef, "ouvrirJourneeCaisse", {"employeId": caissier["id"], "soldeOuverture": compte["solde"]})
    jz = M.journee_zone_du_jour(load_state(db)["journeesCompteZone"], k["zoneId"], auj)
    if not jz:
        action(caissier, "saisirMontantReelZone", {"zoneId": k["zoneId"], "montantReel": 100000, "dateIso": auj})
    if not (jz or {}).get("cloturee"):
        chrono("depot_tontine_s", "Dépôt tontine de bout en bout",
               lambda: action(caissier, "encaisserCotisation", {"carnetId": k["id"], "montant": k["mise"], "dateCollecte": auj}))
    db.close()

    # Actions simultanées sur des carnets différents
    n = min(args.simultanees, len(libres) - 2)
    cibles = [x["id"] for x in libres[1:1 + n]]
    erreurs: list[str] = []

    def verrouiller(carnet_id: str) -> None:
        s = SessionLocal()
        try:
            r = E.run_mutation(s, admin["id"], "basculerVerrouCarnet", {"id": carnet_id})
            if r.get("erreur"):
                erreurs.append(r["erreur"])
        except Exception as exc:  # noqa: BLE001
            erreurs.append(f"{type(exc).__name__}: {str(exc).splitlines()[0]}")
        finally:
            s.close()

    fils = [threading.Thread(target=verrouiller, args=(c,)) for c in cibles]
    t = time.perf_counter()
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    mesures["simultanees_s"] = round(time.perf_counter() - t, 2)
    s = SessionLocal()
    verrouilles = {x["id"] for x in load_state(s)["carnets"] if x["verrouille"]}
    s.close()
    mesures["simultanees_erreurs"] = len(erreurs)
    mesures["simultanees_ecrasees"] = sum(1 for c in cibles if c not in verrouilles) - len(erreurs)
    print(f"{f'{n} actions simultanées':52} {mesures['simultanees_s']:7.2f} s — "
          f"{mesures['simultanees_erreurs']} erreur(s), {mesures['simultanees_ecrasees']} écrasée(s)")
    for e in sorted(set(erreurs)):
        print("   ", e[:150])

    if args.json:
        args.json.write_text(json.dumps(mesures, indent=2, ensure_ascii=False), encoding="utf-8")
        print("Mesures écrites dans", args.json)
    shutil.rmtree(copie.parent, ignore_errors=True)


if __name__ == "__main__":
    main()
