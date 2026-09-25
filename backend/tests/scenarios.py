"""Scénario de référence : deux journées d'activité variées sur l'agence de test.

Sert à comparer deux exécutions (déterminisme, puis équivalence des modes d'écriture en base) et
de charge de travail pour les mesures. Chaque étape doit réussir.
"""
from app import metier as M

from tests.outils import Banc, nouvelles_transactions

J1 = "2026-08-26"


def scenario_complet(b: Banc) -> None:
    j0 = b.horloge.jour
    d = b.etat()
    zones = [z["id"] for z in d["zones"] if z["agenceId"] == b.agence]
    k1, k2, k3 = b.carnet("010001", d), b.carnet("010002", d), b.carnet("020001", d)
    b1, b2, b6 = b.compte("B0001", d), b.compte("B0002", d), b.compte("B0006", d)
    cyc1 = M.cycle_courant_effectif(k1, d["mises"])
    cyc2 = M.cycle_courant_effectif(k2, d["mises"])

    # --- Journée J0 : ouverture, collecte, opérations banque et tontine
    b.ouvrir_journee()
    for z in zones:
        b.saisir_reel(z)
    assert b.deposer(k2, 3) == "OK"
    assert b.deposer(k1, 2, user=b.chef) == "OK"
    b.ok(b.caissier, "deposerCompte", {"compteId": b1["id"], "montant": 5000})
    b.ok(b.caissier, "retirerCompte", {"compteId": b2["id"], "montant": 2000})
    b.ok(b.caissier, "changerMiseCarnet", {"carnetId": k3["id"], "nouvelleMise": 1500, "dateCollecte": j0})
    b.ok(b.admin, "retraitCycle", {"carnetId": k1["id"], "cycle": cyc1, "nombreCarreaux": 2})

    # Transferts des quatre types
    b.ok(b.caissier, "transfertCompteCompte", {"compteSourceId": b1["id"], "compteDestinationId": b6["id"], "montant": 1000})
    b.ok(b.admin, "transfertTontineCompte",
         {"carnetId": k1["id"], "cycle": cyc1, "nombreCarreaux": 1, "compteId": b2["id"], "motif": "scénario"})
    b.ok(b.chef, "transfertTontineTontine",
         {"carnetSourceId": k1["id"], "cycle": cyc1, "nombreCarreaux": 1, "carnetDestinationId": k2["id"]})
    b.ok(b.caissier, "transfertCompteTontine", {"compteSourceId": b2["id"], "carnetDestinationId": k2["id"], "montant": 500})

    # Correction puis annulation d'opérations
    avant = b.etat()
    assert b.deposer(k2, 1) == "OK"
    (tx,) = nouvelles_transactions(avant, b.etat())
    b.ok(b.admin, "corrigerMontantTransaction", {"transactionId": tx["id"], "nouveauMontant": 1000, "motif": "scénario"})
    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "scénario"})

    # Clôture de cycle sans retrait, clôture de la caisse avec un manquant, dépôt après clôture
    b.ok(b.caissier, "cloturerCycle", {"carnetId": k2["id"], "cycle": cyc2, "avecRetrait": False})
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": j0, "montantFermeture": b.theorique(j0) - 500})
    assert b.deposer(k1, 1) == "OK"

    # --- Journée J1 : nouvelle ouverture, collecte, puis retour sur J0
    b.horloge.passer_au(J1)
    b.ouvrir_journee()
    for z in zones:
        b.saisir_reel(z)
    assert b.deposer(k2, 2) == "OK"
    b.ok(b.caissier, "cloturerJourneeZone", {"zoneId": k2["zoneId"], "dateIso": j0})
    b.ok(b.admin, "rouvrirJourneeCaisse", {"employeId": b.caissier, "journee": j0, "motif": "scénario"})
    b.ok(b.admin, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": j0, "montantFermeture": b.theorique(j0)})
    b.ok(b.admin, "corrigerJourneeCaisse",
         {"employeId": b.caissier, "journee": j0, "montantCompte": b.theorique(j0) + 300, "motif": "scénario"})
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J1, "montantFermeture": b.theorique(J1)})
