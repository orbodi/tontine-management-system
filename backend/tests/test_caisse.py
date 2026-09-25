"""Caisse : ouverture, dépôts datés du jour de collecte, clôture, corrections, réouverture,
et dépôt sur une journée déjà clôturée (seule cette journée est recalculée)."""
import pytest

from tests.outils import JOUR_TEST, nouvelles_transactions

J0 = JOUR_TEST
J1 = "2026-08-26"
CARNET = "010002"  # tontine, mise 500, agence de test


@pytest.fixture
def carnet(banc):
    return banc.carnet(CARNET)


def test_depot_refuse_tant_que_la_caisse_du_jour_de_collecte_n_est_pas_ouverte(banc, carnet):
    banc.saisir_reel(carnet["zoneId"])
    for user in (banc.caissier, banc.chef, banc.admin):
        assert "n'est pas ouverte" in banc.deposer(carnet, 1, user=user)

    banc.ouvrir_journee()
    solde = banc.compte_caisse()["solde"]
    assert banc.deposer(carnet, 3) == "OK"
    assert banc.compte_caisse()["solde"] == solde + 3 * carnet["mise"]


def test_correction_de_l_ouverture_d_une_journee_ouverte(collecte, carnet):
    b = collecte
    solde0 = b.compte_caisse()["solde"]
    assert b.deposer(carnet, 3) == "OK"
    assert "pas de montant compté" in b.run(
        b.admin, "corrigerJourneeCaisse", {"employeId": b.caissier, "journee": J0, "montantCompte": 1, "motif": "x"})
    assert "Seul l'administrateur" in b.run(
        b.chef, "corrigerJourneeCaisse", {"employeId": b.caissier, "journee": J0, "soldeOuverture": 1, "motif": "x"})

    b.ok(b.admin, "corrigerJourneeCaisse",
         {"employeId": b.caissier, "journee": J0, "soldeOuverture": solde0 - 1000, "motif": "x"})
    assert b.compte_caisse()["solde"] == solde0 + 3 * carnet["mise"] - 1000


def test_cloture_avec_ecart_met_a_jour_les_cumuls(collecte, carnet):
    b = collecte
    assert b.deposer(carnet, 2) == "OK"
    c0 = b.compte_caisse()
    th = b.theorique(J0)
    assert th == c0["solde"]

    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": th - 500})
    c = b.compte_caisse()
    assert b.arret(J0)["ecart"] == -500
    assert c["cumulManquant"] == c0["cumulManquant"] + 500
    assert c["solde"] == th - 500


def test_depot_sur_journee_cloturee_recalcule_seulement_cette_journee(collecte, carnet):
    b = collecte
    th = b.theorique(J0)
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": th - 500})
    avant = b.etat()
    a0, c0 = b.arret(J0, avant), b.compte_caisse(avant)
    montant = 2 * carnet["mise"]

    # Dépôt sur la journée clôturée : accepté, seule J0 bouge
    assert b.deposer(carnet, 2) == "OK"
    apres = b.etat()
    a1, c1 = b.arret(J0, apres), b.compte_caisse(apres)
    assert a1["soldeTheorique"] == a0["soldeTheorique"] + montant
    assert a1["montantCompte"] == a0["montantCompte"]
    assert a1["ecart"] == a0["ecart"] - montant
    assert a1["totalEntrees"] == a0["totalEntrees"] + montant
    assert a1["nombreOperations"] == a0["nombreOperations"] + 1
    assert c1["cumulManquant"] == c0["cumulManquant"] + montant
    assert c1["solde"] == c0["solde"], "la caisse actuelle ne doit pas bouger"
    assert b.fin_de_journee(J0, apres) == a0["montantCompte"]
    assert a1["corrections"][-1]["type"] == "complement"

    # Annulation (admin) : tout revient
    (tx,) = nouvelles_transactions(avant, apres)
    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "test"})
    fin = b.etat()
    a2, c2 = b.arret(J0, fin), b.compte_caisse(fin)
    assert (a2["soldeTheorique"], a2["ecart"]) == (a0["soldeTheorique"], a0["ecart"])
    assert (c2["cumulManquant"], c2["solde"]) == (c0["cumulManquant"], c0["solde"])


def test_depot_sur_journee_cloturee_ne_touche_pas_le_jour_suivant(collecte, carnet):
    b = collecte
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": b.theorique(J0)})
    b.horloge.passer_au(J1)
    b.ouvrir_journee()
    b.saisir_reel(carnet["zoneId"])
    assert b.deposer(carnet, 1) == "OK"
    avant = b.etat()
    solde, fin_j0, ouverture_j1 = b.compte_caisse(avant)["solde"], b.fin_de_journee(J0, avant), b.fin_de_journee(J1, avant)

    assert b.deposer(carnet, 2, jour=J0) == "OK"
    apres = b.etat()
    assert b.compte_caisse(apres)["solde"] == solde
    assert b.fin_de_journee(J0, apres) == fin_j0
    assert b.fin_de_journee(J1, apres) == ouverture_j1
    assert b.arret(J0, apres)["ecart"] == -2 * carnet["mise"]


def test_jour_sans_ouverture_de_caisse_toujours_refuse(collecte, carnet):
    b = collecte
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": b.theorique(J0)})
    b.horloge.passer_au(J1)
    b.saisir_reel(carnet["zoneId"])
    assert "n'est pas ouverte" in b.deposer(carnet, 1)          # J1 : caisse pas encore ouverte
    assert b.deposer(carnet, 1, jour=J0) == "OK"                 # J0 clôturée : acceptée et recalculée


def test_collecte_de_zone_cloturee_refuse_le_depot(collecte, carnet):
    b = collecte
    b.ok(b.caissier, "cloturerJourneeZone", {"zoneId": carnet["zoneId"], "dateIso": J0})
    assert "cloturee" in b.deposer(carnet, 1)


def test_correction_du_montant_compte_d_une_journee_cloturee(collecte, carnet):
    b = collecte
    cm0 = b.compte_caisse()["cumulManquant"]
    th = b.theorique(J0)
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": th - 500})
    b.ok(b.admin, "corrigerJourneeCaisse",
         {"employeId": b.caissier, "journee": J0, "montantCompte": th, "motif": "recomptage"})
    c = b.compte_caisse()
    assert b.arret(J0)["ecart"] == 0
    assert c["cumulManquant"] == cm0
    assert c["solde"] == th
    assert b.arret(J0)["corrections"][-1]["compteApres"] == th


def test_reouverture_complement_et_recloture(collecte, carnet):
    b = collecte
    assert b.deposer(carnet, 1) == "OK"
    th = b.theorique(J0)
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": th})

    assert "Seul l'administrateur ou le chef" in b.run(
        b.caissier, "rouvrirJourneeCaisse", {"employeId": b.caissier, "journee": J0, "motif": "x"})
    assert "motif est obligatoire" in b.run(b.chef, "rouvrirJourneeCaisse", {"employeId": b.caissier, "journee": J0})
    ops = len([t for t in b.etat()["transactions"] if t["date"][:10] == J0])
    b.ok(b.chef, "rouvrirJourneeCaisse", {"employeId": b.caissier, "journee": J0, "motif": "complément"})
    assert b.arret(J0) is None
    assert len([t for t in b.etat()["transactions"] if t["date"][:10] == J0]) == ops

    assert b.deposer(carnet, 2) == "OK"
    th2 = b.theorique(J0)
    assert th2 == th + 2 * carnet["mise"]
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": th2})
    assert [x.get("type") for x in b.arret(J0)["corrections"]] == ["reouverture"]


def test_journee_passee_rouverte_et_corrigee_sans_toucher_la_caisse_actuelle(collecte, carnet):
    b = collecte
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": b.theorique(J0)})
    b.horloge.passer_au(J1)
    b.ouvrir_journee()
    b.saisir_reel(carnet["zoneId"])
    assert b.deposer(carnet, 1) == "OK"
    solde = b.compte_caisse()["solde"]

    b.ok(b.admin, "rouvrirJourneeCaisse", {"employeId": b.caissier, "journee": J0, "motif": "recomptage"})
    assert b.compte_caisse()["solde"] == solde
    th = b.theorique(J0)
    b.ok(b.admin, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": th + 1000})
    assert b.arret(J0)["ecart"] == 1000
    assert b.compte_caisse()["solde"] == solde
    b.ok(b.admin, "corrigerJourneeCaisse",
         {"employeId": b.caissier, "journee": J0, "montantCompte": th - 1000, "motif": "x"})
    assert b.arret(J0)["ecart"] == -1000
    assert b.compte_caisse()["solde"] == solde


def test_correction_de_montant_sur_journee_cloturee_recalcule_cette_journee(collecte, carnet):
    b = collecte
    avant = b.etat()
    assert b.deposer(carnet, 2) == "OK"
    (tx,) = nouvelles_transactions(avant, b.etat())
    b.ok(b.chef, "arreterCaisse", {"cibleEmployeId": b.caissier, "journee": J0, "montantFermeture": b.theorique(J0)})
    a0, solde = b.arret(J0), b.compte_caisse()["solde"]

    b.ok(b.admin, "corrigerMontantTransaction",
         {"transactionId": tx["id"], "nouveauMontant": tx["montant"] + carnet["mise"], "motif": "x"})
    a1 = b.arret(J0)
    assert a1["soldeTheorique"] == a0["soldeTheorique"] + carnet["mise"]
    assert a1["ecart"] == a0["ecart"] - carnet["mise"]
    assert a1["nombreOperations"] == a0["nombreOperations"]
    assert b.compte_caisse()["solde"] == solde
