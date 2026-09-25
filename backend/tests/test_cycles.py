"""Clôture anticipée d'un cycle, avec ou sans retrait, et son annulation."""
import pytest

from app import metier as M
from tests.outils import nouvelles_transactions

CARNET = "010002"  # tontine, mise 500, cycle 1 entamé


@pytest.fixture
def situation(collecte):
    d = collecte.etat()
    k = collecte.carnet(CARNET, d)
    cycle = M.cycle_courant_effectif(k, d["mises"])
    return collecte, k, cycle, M.carreaux_retirables(k, d["mises"], cycle, d["transactions"])


def test_cloture_avec_retrait_puis_annulation(situation):
    b, k, cycle, retirables = situation
    avant = b.etat()
    b.ok(b.caissier, "cloturerCycle", {"carnetId": k["id"], "cycle": cycle, "avecRetrait": True})
    apres = b.etat()
    k1 = b.carnet(CARNET, apres)
    assert k1["cycleActuel"] == cycle + 1
    assert cycle in k1["cyclesClotures"]
    (tx,) = [t for t in nouvelles_transactions(avant, apres) if "clôture anticipée" in t["description"]]
    assert tx["montant"] == retirables * k["mise"]

    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "test"})
    k2 = b.carnet(CARNET)
    assert (k2["cycleActuel"], cycle in k2["cyclesClotures"]) == (cycle, False)


def test_cloture_sans_retrait_puis_annulation(situation):
    b, k, cycle, retirables = situation
    avant = b.etat()
    b.ok(b.caissier, "cloturerCycle", {"carnetId": k["id"], "cycle": cycle, "avecRetrait": False})
    apres = b.etat()
    k1 = b.carnet(CARNET, apres)
    assert M.carreaux_retirables(k1, apres["mises"], cycle, apres["transactions"]) == retirables
    (tx,) = nouvelles_transactions(avant, apres)
    assert (tx["type"], tx["montant"]) == ("cloture_cycle", 0)
    assert "ne peut pas être modifié" in b.run(
        b.admin, "corrigerMontantTransaction", {"transactionId": tx["id"], "nouveauMontant": 1})
    assert "Aucune mise sur ce cycle" in b.run(b.admin, "cloturerCycle", {"carnetId": k["id"], "avecRetrait": False})

    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "test"})
    k2 = b.carnet(CARNET)
    assert (k2["cycleActuel"], cycle in k2["cyclesClotures"]) == (cycle, False)
