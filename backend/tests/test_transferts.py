"""Transferts compte <-> compte, tontine -> compte, tontine -> tontine, compte -> tontine,
leurs contrôles, leur correction / annulation et le recul avec l'annulation de la journée."""
import pytest

from app import metier as M
from tests.outils import nouvelles_transactions

# Démo, agence de test : 010001 (mise 1 000) et B0001 / B0006 appartiennent au même client ;
# 010002 (mise 500) et B0002 à un autre ; 020003 est une carte bloquée à 1 500.


def _soldes(b, *numeros):
    d = b.etat()
    return {c["numero"]: c["solde"] for c in d["comptes"] if c["numero"] in numeros}


def _cycle(b, numero):
    d = b.etat()
    k = b.carnet(numero, d)
    return k, M.cycle_courant_effectif(k, d["mises"])


def test_compte_vers_compte_controles_correction_annulation(collecte):
    b = collecte
    s0 = _soldes(b, "B0001", "B0002")
    src, dst = b.compte("B0001"), b.compte("B0002")
    avant = b.etat()
    b.ok(b.admin, "transfertCompteCompte",
         {"compteSourceId": src["id"], "compteDestinationId": dst["id"], "montant": 1000, "motif": "test"})
    (tx,) = nouvelles_transactions(avant, b.etat())
    assert tx["clientDestinationId"] == dst["clientId"]
    assert _soldes(b, "B0001", "B0002") == {"B0001": s0["B0001"] - 1000, "B0002": s0["B0002"] + 1000}

    assert "Solde insuffisant" in b.run(
        b.admin, "transfertCompteCompte", {"compteSourceId": src["id"], "compteDestinationId": dst["id"], "montant": 10**9})
    assert "doivent être différents" in b.run(
        b.admin, "transfertCompteCompte", {"compteSourceId": src["id"], "compteDestinationId": src["id"], "montant": 100})
    assert "Montant invalide" in b.run(
        b.admin, "transfertCompteCompte", {"compteSourceId": src["id"], "compteDestinationId": dst["id"], "montant": 0})

    b.ok(b.admin, "corrigerMontantTransaction", {"transactionId": tx["id"], "nouveauMontant": 700, "motif": "erreur"})
    assert _soldes(b, "B0001", "B0002") == {"B0001": s0["B0001"] - 700, "B0002": s0["B0002"] + 700}
    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "test"})
    assert _soldes(b, "B0001", "B0002") == s0


def test_compte_vers_compte_autre_client_reserve_admin_et_chef(collecte):
    b = collecte
    b1, b2, b6 = b.compte("B0001"), b.compte("B0002"), b.compte("B0006")
    assert "réservé à l'administrateur ou au chef" in b.run(
        b.caissier, "transfertCompteCompte", {"compteSourceId": b1["id"], "compteDestinationId": b2["id"], "montant": 100})
    b.ok(b.caissier, "transfertCompteCompte", {"compteSourceId": b1["id"], "compteDestinationId": b6["id"], "montant": 100})
    b.ok(b.chef, "transfertCompteCompte", {"compteSourceId": b1["id"], "compteDestinationId": b2["id"], "montant": 100})


def test_tontine_vers_compte_d_un_autre_client_puis_annulation(collecte):
    b = collecte
    k, cycle = _cycle(b, "010001")
    d = b.etat()
    retirables = M.carreaux_retirables(k, d["mises"], cycle, d["transactions"])
    assert retirables >= 1
    s0 = _soldes(b, "B0002")["B0002"]
    b.ok(b.admin, "transfertTontineCompte",
         {"carnetId": k["id"], "cycle": cycle, "nombreCarreaux": 1, "compteId": b.compte("B0002")["id"], "motif": "test"})
    apres = b.etat()
    assert _soldes(b, "B0002")["B0002"] == s0 + k["mise"]
    (tx,) = nouvelles_transactions(d, apres)

    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "test"})
    fin = b.etat()
    assert _soldes(b, "B0002")["B0002"] == s0
    assert M.carreaux_retirables(b.carnet("010001", fin), fin["mises"], cycle, fin["transactions"]) == retirables


def test_tontine_vers_tontine_controles_et_annulation(collecte):
    b = collecte
    a, cyc_a = _cycle(b, "010001")
    dest, cyc_d = _cycle(b, "010002")
    n_a, n_d = b.nets(a["id"], cyc_a), b.nets(dest["id"], cyc_d)

    def transfert(user, source, destination, nombre, cycle):
        return b.run(user, "transfertTontineTontine", {
            "carnetSourceId": source["id"], "cycle": cycle, "nombreCarreaux": nombre,
            "carnetDestinationId": destination["id"], "motif": "test"})

    assert "réservé à l'administrateur ou au chef" in transfert(b.caissier, a, dest, 2, cyc_a)
    assert "doivent être différents" in transfert(b.chef, a, a, 2, cyc_a)
    assert "Pas assez de mises" in transfert(b.chef, a, dest, 99, cyc_a)
    # 2 mises de 500 = 1 000 : pas un multiple de la mise de 1 500
    assert "multiple" in transfert(b.chef, dest, b.carnet("020003"), 2, cyc_d)

    avant = b.etat()
    assert transfert(b.chef, a, dest, 2, cyc_a) == "OK"          # 2 mises de 1 000 = 4 mises de 500
    apres = b.etat()
    (tx,) = nouvelles_transactions(avant, apres)
    assert (tx["type"], tx["montant"], tx["clientDestinationId"]) == ("transfert_tontine_tontine", 2000, dest["clientId"])
    assert b.nets(a["id"], cyc_a, apres) == n_a - 2
    assert sum(b.nets(dest["id"], c, apres) for c in (cyc_d, cyc_d + 1)) == n_d + 4
    assert b.compte_caisse(apres)["solde"] == b.compte_caisse(avant)["solde"]
    assert "ne peut pas être modifié" in b.run(
        b.admin, "corrigerMontantTransaction", {"transactionId": tx["id"], "nouveauMontant": 1000})

    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "test"})
    fin = b.etat()
    assert b.nets(a["id"], cyc_a, fin) == n_a
    assert b.nets(dest["id"], cyc_d, fin) == n_d


def test_compte_vers_tontine_controles_et_annulation(collecte):
    b = collecte
    k, cycle = _cycle(b, "010002")
    b2 = b.compte("B0002")  # même client que 010002
    assert "multiple de la mise" in b.run(
        b.caissier, "transfertCompteTontine", {"compteSourceId": b2["id"], "carnetDestinationId": k["id"], "montant": 300})
    assert "réservé à l'administrateur ou au chef" in b.run(
        b.caissier, "transfertCompteTontine",
        {"compteSourceId": b.compte("B0001")["id"], "carnetDestinationId": k["id"], "montant": 500})

    avant = b.etat()
    n0, caisse0 = b.nets(k["id"], cycle, avant), b.compte_caisse(avant)["solde"]
    b.ok(b.caissier, "transfertCompteTontine", {"compteSourceId": b2["id"], "carnetDestinationId": k["id"], "montant": 500})
    apres = b.etat()
    (tx,) = nouvelles_transactions(avant, apres)
    assert b.compte("B0002", apres)["solde"] == b2["solde"] - 500
    assert b.nets(k["id"], cycle, apres) == n0 + 1
    assert b.compte_caisse(apres)["solde"] == caisse0

    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "test"})
    fin = b.etat()
    assert (b.compte("B0002", fin)["solde"], b.nets(k["id"], cycle, fin)) == (b2["solde"], n0)


def test_annulation_de_la_journee_recule_les_transferts(collecte):
    b = collecte
    a, cyc_a = _cycle(b, "010001")
    dest, _ = _cycle(b, "010002")
    b.ok(b.chef, "transfertTontineTontine", {
        "carnetSourceId": a["id"], "cycle": cyc_a, "nombreCarreaux": 1, "carnetDestinationId": dest["id"]})
    b.ok(b.caissier, "transfertCompteTontine",
         {"compteSourceId": b.compte("B0002")["id"], "carnetDestinationId": dest["id"], "montant": 500})
    assert "transferts" in b.run(b.admin, "supprimerCarnet", {"id": dest["id"]})

    b.ok(b.admin, "annulerOuvertureJourneeCaisse", {"employeId": b.caissier})
    d = b.etat()
    actifs = [t for t in d["transactions"]
              if t["type"] in ("transfert_tontine_tontine", "transfert_compte_tontine") and not t.get("annulee")]
    assert actifs == []
    assert [m for m in d["mises"] if m.get("transactionId")] == []
