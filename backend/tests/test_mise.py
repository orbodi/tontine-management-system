"""Changement de mise : une mise par cycle (un cycle terminé garde la sienne), hausse avec complément,
baisse par conversion du cycle en cours (10 × 500 F = 5 000 F -> 25 × 200 F), P.C. qui suit la mise."""
import pytest

from app import metier as M
from tests.outils import nouvelles_transactions

CARNET = "010002"  # tontine, mise 500, cycle 1 entamé


def _situation(b):
    d = b.etat()
    k = b.carnet(CARNET, d)
    cycle = M.cycle_courant_effectif(k, d["mises"])
    return d, k, cycle


def _terminer_cycle_en_cours(b):
    """Remplit le cycle en cours (31 carreaux) : le suivant devient le cycle en cours, vide."""
    d, k, cycle = _situation(b)
    assert b.deposer(k, 31 - M.carreaux_deposes(k, d["mises"], cycle)) == "OK"
    _, k, suivant = _situation(b)
    assert suivant == cycle + 1
    return cycle, suivant


def _deposer_avec_pc(b, k, nombre):
    return b.run(b.caissier, "encaisserCotisation", {
        "carnetId": k["id"], "montant": nombre * k["mise"], "dateCollecte": b.horloge.jour, "payerPc": True})


@pytest.fixture
def cycle_de_10_mises(collecte):
    """Cycle précédent terminé (non retiré), cycle en cours : 10 mises de 500 F dont la P.C. payée."""
    b = collecte
    termine, en_cours = _terminer_cycle_en_cours(b)
    _, k, _ = _situation(b)
    assert _deposer_avec_pc(b, k, 10) == "OK"
    return b, termine, en_cours


def _changer(b, user, mise):
    k = b.carnet(CARNET)
    return b.run(user, "changerMiseCarnet", {"carnetId": k["id"], "nouvelleMise": mise, "dateCollecte": b.horloge.jour})


def test_mises_proposees_pour_une_baisse(cycle_de_10_mises):
    b, _, en_cours = cycle_de_10_mises
    d, k, _ = _situation(b)
    possibles = M.mises_possibles_reduction(k, d["mises"], en_cours)
    # 5 000 F en carreaux entiers, 31 au plus : 250 F (20 carreaux) ou 200 F (25 carreaux)
    assert [(x["mise"], x["carreaux"]) for x in possibles] == [(250, 20), (200, 25)]


def test_baisse_convertit_le_cycle_en_cours_et_rend_la_pc(cycle_de_10_mises):
    b, termine, en_cours = cycle_de_10_mises
    avant = b.etat()
    caisse = b.compte_caisse(avant)["solde"]
    assert _changer(b, b.chef, 200) == "OK"
    apres = b.etat()
    k = b.carnet(CARNET, apres)
    assert k["mise"] == 200
    assert M.carreaux_deposes(k, apres["mises"], en_cours) == 25
    assert M.carreaux_retirables(k, apres["mises"], en_cours, apres["transactions"]) == 24  # P.C. : 1 carreau
    (tx,) = nouvelles_transactions(avant, apres)
    assert (tx["type"], tx["montant"]) == ("reduction_mise", 300)  # P.C. 500 -> 200 : 300 F rendus au client
    assert b.compte_caisse(apres)["solde"] == caisse  # aucun mouvement d'argent
    # Le cycle terminé garde sa mise
    assert (M.mise_du_cycle(k, termine), M.mise_du_cycle(k, en_cours)) == (500, 200)

    solde = b.compte_caisse()["solde"]
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": en_cours, "nombreCarreaux": 24})
    assert b.compte_caisse()["solde"] == solde - 24 * 200  # 4 800 F = 4 500 F versés + 300 F de P.C.
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": termine, "nombreCarreaux": 5})
    assert b.compte_caisse()["solde"] == solde - 4800 - 5 * 500  # cycle terminé : toujours 500 F le carreau


def test_hausse_ne_reevalue_pas_un_cycle_termine(collecte):
    b = collecte
    termine, _ = _terminer_cycle_en_cours(b)
    assert _changer(b, b.caissier, 1000) == "OK"  # cycle en cours vide : pas de complément
    k = b.carnet(CARNET)
    solde = b.compte_caisse()["solde"]
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": termine, "nombreCarreaux": 5})
    assert b.compte_caisse()["solde"] == solde - 5 * 500


def test_baisse_sans_depot_sur_le_cycle_en_cours(collecte):
    b = collecte
    termine, en_cours = _terminer_cycle_en_cours(b)
    avant = b.etat()
    assert _changer(b, b.chef, 300) == "OK"  # aucun dépôt : toute mise plus basse est possible
    apres = b.etat()
    k = b.carnet(CARNET, apres)
    (tx,) = nouvelles_transactions(avant, apres)
    assert (tx["type"], tx["montant"]) == ("reduction_mise", 0)
    assert len(apres["mises"]) == len(avant["mises"])
    assert (M.mise_du_cycle(k, termine), M.mise_du_cycle(k, en_cours)) == (500, 300)


def test_baisse_refusee_hors_mises_proposees_et_pour_le_caissier(cycle_de_10_mises):
    b, _, _ = cycle_de_10_mises
    assert "réservé à l'administrateur ou au chef" in _changer(b, b.caissier, 200)
    erreur = _changer(b, b.chef, 300)  # 5 000 / 300 : pas un nombre entier de carreaux
    assert "impossible" in erreur and "250 F (20 carreaux), 200 F (25 carreaux)" in erreur
    assert "impossible" in _changer(b, b.chef, 100)  # 50 carreaux : plus que 31
    assert b.carnet(CARNET)["mise"] == 500


def test_baisse_avec_retrait_partiel(cycle_de_10_mises):
    b, _, en_cours = cycle_de_10_mises
    k = b.carnet(CARNET)
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": en_cours, "nombreCarreaux": 3})
    d = b.etat()
    # Retrait de 1 500 F : 200 F donnerait 7,5 carreaux retirés -> seule 250 F reste possible
    assert [x["mise"] for x in M.mises_possibles_reduction(b.carnet(CARNET, d), d["mises"], en_cours)] == [250]
    assert _changer(b, b.chef, 250) == "OK"
    d = b.etat()
    k = b.carnet(CARNET, d)
    assert (M.carreaux_deposes(k, d["mises"], en_cours), M.carreaux_nets(k, d["mises"], en_cours)) == (20, 14)
    # 6 mises restantes à 500 F (3 000 F) + P.C. ramenée à 250 F (250 F rendus) = 13 carreaux de 250 F
    assert M.carreaux_retirables(k, d["mises"], en_cours, d["transactions"]) * 250 == 3250


def test_annulation_de_la_baisse(cycle_de_10_mises):
    b, _, en_cours = cycle_de_10_mises
    avant = b.etat()
    assert _changer(b, b.chef, 200) == "OK"
    (tx,) = nouvelles_transactions(avant, b.etat())
    b.ok(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "erreur"})
    d = b.etat()
    k = b.carnet(CARNET, d)
    assert (k["mise"], k["historiqueMises"]) == (500, [])
    assert M.carreaux_deposes(k, d["mises"], en_cours) == 10


def test_annulation_de_la_baisse_refusee_apres_une_operation(cycle_de_10_mises):
    b, _, _ = cycle_de_10_mises
    avant = b.etat()
    assert _changer(b, b.chef, 200) == "OK"
    (tx,) = nouvelles_transactions(avant, b.etat())
    assert b.deposer(b.carnet(CARNET), 1) == "OK"
    assert "des opérations ont eu lieu" in b.run(b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "x"})


def test_depot_anterieur_a_la_baisse_non_annulable(collecte):
    b = collecte
    _terminer_cycle_en_cours(b)
    avant = b.etat()
    assert _deposer_avec_pc(b, b.carnet(CARNET), 10) == "OK"
    depot = next(t for t in nouvelles_transactions(avant, b.etat()) if t["type"] == "mise_tontine")
    avant = b.etat()
    assert _changer(b, b.chef, 200) == "OK"
    (baisse,) = nouvelles_transactions(avant, b.etat())

    assert "Annulez d'abord ce changement de mise" in b.run(
        b.admin, "annulerTransaction", {"transactionId": depot["id"], "motif": "x"})
    assert "Annulez d'abord ce changement de mise" in b.run(
        b.admin, "corrigerMontantTransaction", {"transactionId": depot["id"], "nouveauMontant": 1000, "motif": "x"})
    b.ok(b.admin, "annulerTransaction", {"transactionId": baisse["id"], "motif": "x"})
    b.ok(b.admin, "annulerTransaction", {"transactionId": depot["id"], "motif": "x"})


def test_annulation_de_la_journee_defait_le_changement_de_mise(cycle_de_10_mises):
    b, _, _ = cycle_de_10_mises
    assert _changer(b, b.chef, 200) == "OK"
    b.ok(b.admin, "annulerOuvertureJourneeCaisse", {"employeId": b.caissier})
    d = b.etat()
    k = b.carnet(CARNET, d)
    assert (k["mise"], k["historiqueMises"]) == (500, [])
    assert not [t for t in d["transactions"] if t["type"] == "reduction_mise"]
    assert not [m for m in d["mises"] if m["carnetId"] == k["id"] and m.get("transactionId")]
