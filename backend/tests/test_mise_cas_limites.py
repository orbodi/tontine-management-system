"""Changement de mise : cas limites (relecture de la fonctionnalité).

Invariant vérifié partout : pour chaque cycle d'un carnet, l'argent inscrit (somme des `montant` des
lignes de mise, P.C. comprise) = carreaux nets × mise du cycle
(= ce qu'on peut rendre au client + P.C. gardée par la société).
"""
from app import metier as M
from tests.outils import nouvelles_transactions

CARNET = "010002"  # tontine, mise 500, cycle 1 : 12 carreaux dont la P.C.
J_RETARD = "2026-08-22"  # journée de caisse de la démo restée ouverte


def verifier_argent(b, numero=CARNET):
    d = b.etat()
    k = b.carnet(numero, d)
    ecarts = []
    for cy in sorted({int(m["cycle"]) for m in d["mises"] if m["carnetId"] == k["id"]}):
        somme = sum(float(m["montant"]) for m in d["mises"] if m["carnetId"] == k["id"] and int(m["cycle"]) == cy)
        nets = M.carreaux_nets(k, d["mises"], cy)
        valeur = nets * M.mise_du_cycle(k, cy)
        if abs(somme - valeur) > 0.01:
            ecarts.append((cy, somme, nets, M.mise_du_cycle(k, cy)))
    assert not ecarts, f"carnet {numero} : (cycle, argent inscrit, carreaux nets, mise du cycle) {ecarts}"


def cycle_en_cours(b, numero=CARNET):
    d = b.etat()
    k = b.carnet(numero, d)
    return M.cycle_courant_effectif(k, d["mises"])


def changer(b, user, mise, numero=CARNET, jour=None):
    k = b.carnet(numero)
    return b.run(user, "changerMiseCarnet",
                 {"carnetId": k["id"], "nouvelleMise": mise, "dateCollecte": jour or b.horloge.jour})


def faire(b, user, action, payload):
    """Exécute une action, renvoie les transactions créées."""
    avant = b.etat()
    b.ok(user, action, payload)
    return nouvelles_transactions(avant, b.etat())


def annuler(b, tx, user=None):
    return b.run(user or b.admin, "annulerTransaction", {"transactionId": tx["id"], "motif": "revue"})


def deposer_pc(b, k, nombre, jour=None):
    return b.run(b.caissier, "encaisserCotisation", {
        "carnetId": k["id"], "montant": nombre * k["mise"], "dateCollecte": jour or b.horloge.jour, "payerPc": True})


def terminer_cycle(b, numero=CARNET):
    d = b.etat()
    k = b.carnet(numero, d)
    cy = M.cycle_courant_effectif(k, d["mises"])
    assert b.deposer(k, 31 - M.carreaux_deposes(k, d["mises"], cy)) == "OK"
    return cy


# ---------------------------------------------------------------------------------------------
# 1. Changements successifs
# ---------------------------------------------------------------------------------------------

def test_hausse_puis_baisse_meme_cycle(collecte):
    b = collecte
    (hausse,) = [t for t in faire(b, b.caissier, "changerMiseCarnet",
                                  {"carnetId": b.carnet(CARNET)["id"], "nouvelleMise": 1000,
                                   "dateCollecte": b.horloge.jour}) if t["type"] == "complement_mise"]
    assert hausse["montant"] == 12 * 500
    d = b.etat()
    k = b.carnet(CARNET, d)
    assert [x["mise"] for x in M.mises_possibles_reduction(k, d["mises"], 1)] == [800, 750, 600, 500, 480, 400]
    (baisse,) = faire(b, b.chef, "changerMiseCarnet", {"carnetId": k["id"], "nouvelleMise": 400})
    assert baisse["montant"] == 600  # P.C. 1000 -> 400
    verifier_argent(b)
    d = b.etat()
    k = b.carnet(CARNET, d)
    assert M.carreaux_retirables(k, d["mises"], 1, d["transactions"]) * 400 + 400 == 12000
    # Ordre d'annulation imposé : la baisse d'abord
    assert "Annulez d'abord ce changement de mise" in annuler(b, hausse)
    assert annuler(b, baisse) == "OK"
    assert b.carnet(CARNET)["mise"] == 1000
    verifier_argent(b)
    assert annuler(b, hausse) == "OK"
    k = b.carnet(CARNET)
    assert (k["mise"], k["historiqueMises"]) == (500, [])
    verifier_argent(b)


def test_baisse_puis_hausse_meme_cycle(collecte):
    b = collecte
    k = b.carnet(CARNET)
    (baisse,) = faire(b, b.chef, "changerMiseCarnet", {"carnetId": k["id"], "nouvelleMise": 200})
    txs = faire(b, b.caissier, "changerMiseCarnet", {"carnetId": k["id"], "nouvelleMise": 250, "dateCollecte": b.horloge.jour})
    (hausse,) = [t for t in txs if t["type"] == "complement_mise"]
    assert hausse["montant"] == 30 * 50
    verifier_argent(b)
    assert "changée de nouveau" in annuler(b, baisse)
    assert annuler(b, hausse) == "OK"
    assert annuler(b, baisse) == "OK"
    k = b.carnet(CARNET)
    assert (k["mise"], k["historiqueMises"]) == (500, [])
    verifier_argent(b)


def test_deux_baisses_meme_cycle(collecte):
    b = collecte
    k = b.carnet(CARNET)
    (b1,) = faire(b, b.chef, "changerMiseCarnet", {"carnetId": k["id"], "nouvelleMise": 250})
    (b2,) = faire(b, b.chef, "changerMiseCarnet", {"carnetId": k["id"], "nouvelleMise": 200})
    assert (b1["montant"], b2["montant"]) == (250, 50)  # P.C. rendue au total : 300
    verifier_argent(b)
    assert "changée de nouveau" in annuler(b, b1)
    assert annuler(b, b2) == "OK" and annuler(b, b1) == "OK"
    verifier_argent(b)


def test_changements_sur_des_cycles_differents(collecte):
    b = collecte
    k = b.carnet(CARNET)
    assert changer(b, b.chef, 200) == "OK"          # cycle 1 : 12 -> 30 carreaux de 200
    assert b.deposer(b.carnet(CARNET), 1) == "OK"   # cycle 1 plein
    assert cycle_en_cours(b) == 2
    assert changer(b, b.caissier, 1000) == "OK"     # cycle 2 vide : pas de complément
    assert b.deposer(b.carnet(CARNET), 5) == "OK"
    k = b.carnet(CARNET)
    assert (M.mise_du_cycle(k, 1), M.mise_du_cycle(k, 2)) == (200, 1000)
    verifier_argent(b)
    solde = b.compte_caisse()["solde"]
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 1, "nombreCarreaux": 30})
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 2, "nombreCarreaux": 4})
    assert b.compte_caisse()["solde"] == solde - 30 * 200 - 4 * 1000
    verifier_argent(b)


# ---------------------------------------------------------------------------------------------
# 2. Baisse après retrait / transferts
# ---------------------------------------------------------------------------------------------

def test_baisse_apres_transfert_tontine_compte(collecte):
    b = collecte
    k = b.carnet(CARNET)
    (tr,) = faire(b, b.admin, "transfertTontineCompte",
                  {"carnetId": k["id"], "cycle": 1, "nombreCarreaux": 2, "compteId": b.compte("B0002")["id"], "motif": "x"})
    d = b.etat()
    assert [x["mise"] for x in M.mises_possibles_reduction(b.carnet(CARNET, d), d["mises"], 1)] == [250, 200]
    assert changer(b, b.chef, 250) == "OK"
    verifier_argent(b)
    d = b.etat()
    k = b.carnet(CARNET, d)
    assert M.carreaux_retirables(k, d["mises"], 1, d["transactions"]) * 250 + 250 == 6000 - 1000
    assert "Annulez d'abord ce changement de mise" in annuler(b, tr)


def test_baisse_apres_transfert_tontine_tontine_source_et_destination(collecte):
    b = collecte
    src, dst = b.carnet(CARNET), b.carnet("020001")  # 500 F -> 1000 F (autre client)
    (tr,) = faire(b, b.admin, "transfertTontineTontine",
                  {"carnetSourceId": src["id"], "cycle": 1, "nombreCarreaux": 2, "carnetDestinationId": dst["id"]})
    assert changer(b, b.chef, 250) == "OK"
    assert changer(b, b.chef, 950, numero="020001") == "OK"  # 19 carreaux de 1000 -> 20 de 950
    verifier_argent(b)
    verifier_argent(b, "020001")
    assert "Annulez d'abord ce changement de mise" in annuler(b, tr)


def test_baisse_apres_transfert_compte_tontine_entrant(collecte):
    b = collecte
    k = b.carnet(CARNET)
    (tr,) = faire(b, b.admin, "transfertCompteTontine",
                  {"compteSourceId": b.compte("B0002")["id"], "carnetDestinationId": k["id"], "montant": 1000})
    assert changer(b, b.chef, 250) == "OK"  # 14 carreaux (7 000 F) -> 28 de 250
    verifier_argent(b)
    assert "Annulez d'abord ce changement de mise" in annuler(b, tr)


def test_annulation_transfert_qui_a_rempli_le_cycle_puis_changement_de_mise(collecte):
    """Le transfert entrant remplit le cycle 1 ; la mise change sur le cycle 2 (vide) ; annuler le
    transfert rouvre le cycle 1 alors qu'il garde l'ancienne mise (garde-fou absent de
    _annuler_mises_transfert)."""
    b = collecte
    k = b.carnet(CARNET)
    (tr,) = faire(b, b.admin, "transfertCompteTontine",
                  {"compteSourceId": b.compte("B0002")["id"], "carnetDestinationId": k["id"], "montant": 19 * 500})
    assert cycle_en_cours(b) == 2
    assert changer(b, b.caissier, 1000) == "OK"  # cycle 2 vide : simple changement
    resultat = annuler(b, tr)
    if resultat == "OK":
        # Le cycle 1 (mise 500) redevient le cycle en cours ; les dépôts s'y font à 1 000 F
        assert cycle_en_cours(b) == 1
        assert b.deposer(b.carnet(CARNET), 2) == "OK"
        verifier_argent(b)  # échoue : 2 000 F versés, 2 carreaux valorisés 500 F
    assert "Annulez d'abord le changement de mise" in resultat


# ---------------------------------------------------------------------------------------------
# 3. P.C.
# ---------------------------------------------------------------------------------------------

def test_pc_non_payee_puis_payee_apres_la_baisse(collecte):
    b = collecte
    terminer_cycle(b)
    assert b.deposer(b.carnet(CARNET), 10) == "OK"  # cycle 2 : 10 × 500 sans P.C.
    (baisse,) = faire(b, b.chef, "changerMiseCarnet", {"carnetId": b.carnet(CARNET)["id"], "nouvelleMise": 200})
    assert baisse["montant"] == 0
    assert deposer_pc(b, b.carnet(CARNET), 1) == "OK"
    d = b.etat()
    k = b.carnet(CARNET, d)
    pc = [t for t in d["transactions"] if t["type"] == "commission_tontine" and f"carnet {CARNET}, cycle 2" in t["description"]]
    assert [t["montant"] for t in pc] == [200]
    assert M.carreaux_retirables(k, d["mises"], 2, d["transactions"]) == 25
    verifier_argent(b)


# ---------------------------------------------------------------------------------------------
# 4. Clôtures
# ---------------------------------------------------------------------------------------------

def test_cloture_avec_retrait_apres_baisse_puis_annulations(collecte):
    b = collecte
    terminer_cycle(b)
    assert deposer_pc(b, b.carnet(CARNET), 10) == "OK"
    (baisse,) = faire(b, b.chef, "changerMiseCarnet", {"carnetId": b.carnet(CARNET)["id"], "nouvelleMise": 200})
    solde = b.compte_caisse()["solde"]
    (clo,) = faire(b, b.admin, "cloturerCycle", {"carnetId": b.carnet(CARNET)["id"], "cycle": 2, "avecRetrait": True})
    assert clo["montant"] == 24 * 200
    assert b.compte_caisse()["solde"] == solde - 4800
    verifier_argent(b)
    assert "des opérations ont eu lieu" in annuler(b, baisse)
    assert annuler(b, clo) == "OK"
    assert cycle_en_cours(b) == 2
    verifier_argent(b)
    assert annuler(b, baisse) == "OK"
    assert b.carnet(CARNET)["mise"] == 500
    verifier_argent(b)


def test_cloture_sans_retrait_apres_baisse(collecte):
    b = collecte
    terminer_cycle(b)
    assert deposer_pc(b, b.carnet(CARNET), 10) == "OK"
    assert changer(b, b.chef, 200) == "OK"
    k = b.carnet(CARNET)
    b.ok(b.admin, "cloturerCycle", {"carnetId": k["id"], "cycle": 2, "avecRetrait": False})
    assert b.deposer(b.carnet(CARNET), 3) == "OK"  # cycle 3 à 200
    solde = b.compte_caisse()["solde"]
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 2, "nombreCarreaux": 24})
    assert b.compte_caisse()["solde"] == solde - 24 * 200
    verifier_argent(b)


def test_cloture_puis_changement_puis_annulation_de_la_cloture(collecte):
    b = collecte
    k = b.carnet(CARNET)
    (clo,) = faire(b, b.admin, "cloturerCycle", {"carnetId": k["id"], "cycle": 1, "avecRetrait": False})
    assert changer(b, b.chef, 200) == "OK"  # cycle 2 vide
    assert "la mise a été changée depuis" in annuler(b, clo)
    solde = b.compte_caisse()["solde"]
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 1, "nombreCarreaux": 11})
    assert b.compte_caisse()["solde"] == solde - 11 * 500
    verifier_argent(b)


# ---------------------------------------------------------------------------------------------
# 5. Renouvellement (cycle 13)
# ---------------------------------------------------------------------------------------------

def test_baisse_au_cycle_13_puis_renouvellement(collecte):
    b = collecte
    numero = "010001"  # mise 1000, cycle 2 : 24 carreaux
    k = b.carnet(numero)
    assert b.deposer(k, 7 + 31 * 10) == "OK"  # cycles 2 à 12 pleins
    d = b.etat()
    k = b.carnet(numero, d)
    assert M.cycle_courant_effectif(k, d["mises"]) == 13
    assert M.besoin_renouvellement_carnet(k, d["mises"], d["transactions"])
    assert changer(b, b.chef, 500, numero=numero) == "OK"
    k = b.carnet(numero)
    assert k["historiqueMises"][-1]["cycle"] == 13
    b.ok(b.caissier, "renouvelerCarnet", {"carnetId": k["id"], "dateCollecte": b.horloge.jour})
    assert deposer_pc(b, b.carnet(numero), 4) == "OK"
    k = b.carnet(numero)
    assert (M.mise_du_cycle(k, 12), M.mise_du_cycle(k, 13)) == (1000, 500)
    verifier_argent(b, numero)
    solde = b.compte_caisse()["solde"]
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 12, "nombreCarreaux": 30})
    assert b.compte_caisse()["solde"] == solde - 30 * 1000


# ---------------------------------------------------------------------------------------------
# 6. Cartes bloquée / enfants
# ---------------------------------------------------------------------------------------------

def test_baisse_carte_bloquee_et_carte_enfants(collecte):
    b = collecte
    (baisse,) = faire(b, b.chef, "changerMiseCarnet", {"carnetId": b.carnet("020003")["id"], "nouvelleMise": 500})
    assert baisse["montant"] == 1000  # P.C. 1500 -> 500
    verifier_argent(b, "020003")
    k = b.carnet("020003")
    assert "Retrait non autorise" in b.run(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 1, "nombreCarreaux": 1})
    b.ok(b.admin, "basculerRetraitCarnetAdmin", {"id": k["id"]})
    solde = b.compte_caisse()["solde"]
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 1, "nombreCarreaux": 29})
    assert b.compte_caisse()["solde"] == solde - 29 * 500
    verifier_argent(b, "020003")
    # carte enfants : 26 × 500 = 13 000 F ne tombe juste sur aucun nombre de carreaux de 27 à 31
    assert "Aucune mise plus basse possible" in changer(b, b.chef, 400, numero="020002")


# ---------------------------------------------------------------------------------------------
# 7. Corrections de montant
# ---------------------------------------------------------------------------------------------

def test_correction_depot_fait_apres_la_baisse(collecte):
    b = collecte
    assert changer(b, b.chef, 250) == "OK"  # 24 carreaux de 250
    avant = b.etat()
    assert b.deposer(b.carnet(CARNET), 2) == "OK"
    (dep,) = nouvelles_transactions(avant, b.etat())
    b.ok(b.admin, "corrigerMontantTransaction", {"transactionId": dep["id"], "nouveauMontant": 750, "motif": "x"})
    verifier_argent(b)
    assert M.carreaux_deposes(b.carnet(CARNET), b.etat()["mises"], 1) == 27
    assert "dépasserait" in b.run(b.admin, "corrigerMontantTransaction",
                                  {"transactionId": dep["id"], "nouveauMontant": 2500, "motif": "x"})
    assert annuler(b, dep) == "OK"
    verifier_argent(b)


def test_correction_du_depot_qui_a_rempli_le_cycle_avant_un_changement(collecte):
    b = collecte
    avant = b.etat()
    terminer_cycle(b)  # 19 × 500 aujourd'hui
    (dep,) = [t for t in nouvelles_transactions(avant, b.etat()) if t["type"] == "mise_tontine"]
    assert changer(b, b.caissier, 1000) == "OK"  # cycle 2 vide
    assert "redeviendrait en cours" in b.run(
        b.admin, "corrigerMontantTransaction", {"transactionId": dep["id"], "nouveauMontant": 9000, "motif": "x"})
    assert "redeviendrait en cours" in annuler(b, dep)
    verifier_argent(b)


def _pc_apres_changement(b, nouvelle, user):
    terminer_cycle(b)
    assert b.deposer(b.carnet(CARNET), 10) == "OK"  # cycle 2 : 10 × 500 sans P.C., aujourd'hui
    assert changer(b, user, nouvelle) == "OK"
    avant = b.etat()
    assert deposer_pc(b, b.carnet(CARNET), 3) == "OK"
    return next(t for t in nouvelles_transactions(avant, b.etat()) if t["type"] == "commission_tontine")


def test_annulation_pc_payee_apres_une_baisse_le_meme_jour(collecte):
    b = collecte
    pc = _pc_apres_changement(b, 200, b.chef)
    assert annuler(b, pc) == "OK"
    verifier_argent(b)


def test_annulation_pc_payee_apres_une_hausse_le_meme_jour(collecte):
    b = collecte
    pc = _pc_apres_changement(b, 1000, b.caissier)
    assert annuler(b, pc) == "OK"
    verifier_argent(b)


def test_complement_de_hausse_non_corrigeable(collecte):
    """Le complément est calculé par l'application (carreaux × écart) : on l'annule, on ne le corrige pas."""
    b = collecte
    (hausse,) = [t for t in faire(b, b.caissier, "changerMiseCarnet",
                                  {"carnetId": b.carnet(CARNET)["id"], "nouvelleMise": 1000,
                                   "dateCollecte": b.horloge.jour}) if t["type"] == "complement_mise"]
    assert "ne peut pas être modifié" in b.run(
        b.admin, "corrigerMontantTransaction", {"transactionId": hausse["id"], "nouveauMontant": 5000, "motif": "x"})
    verifier_argent(b)


# ---------------------------------------------------------------------------------------------
# 8. Annulation de journée de caisse
# ---------------------------------------------------------------------------------------------

def test_annulation_journee_depots_avant_et_apres_la_baisse_meme_jour(collecte):
    b = collecte
    avant = b.etat()
    assert b.deposer(b.carnet(CARNET), 3) == "OK"
    assert changer(b, b.chef, 250) == "OK"  # 15 × 500 -> 30 × 250
    assert b.deposer(b.carnet(CARNET), 1) == "OK"
    b.ok(b.admin, "annulerOuvertureJourneeCaisse", {"employeId": b.caissier})
    d = b.etat()
    k = b.carnet(CARNET, d)
    assert (k["mise"], k["historiqueMises"]) == (500, [])
    assert M.carreaux_deposes(k, d["mises"], 1) == 12
    assert len(d["mises"]) == len(avant["mises"])
    verifier_argent(b)


def test_annulation_journee_en_retard_apres_une_baisse_faite_aujourd_hui(collecte):
    """Dépôt collecté le 22/08 (journée de caisse restée ouverte), baisse le 25/08 : la journée du 22/08 ne
    s'annule plus (son dépôt a été converti) tant que la baisse tient."""
    b = collecte
    k = b.carnet(CARNET)
    b.saisir_reel(k["zoneId"], jour=J_RETARD)
    assert b.deposer(k, 3, jour=J_RETARD) == "OK"  # 15 × 500 = 7 500 F
    assert changer(b, b.chef, 250) == "OK"         # -> 30 × 250
    assert "a été changée après des opérations de cette journée" in b.run(
        b.admin, "annulerOuvertureJourneeCaisse", {"employeId": b.caissier, "journee": J_RETARD})
    d = b.etat()
    k = b.carnet(CARNET, d)
    verifier_argent(b)


def test_annulation_journee_du_jour_apres_une_hausse_sur_collecte_en_retard(collecte):
    """Hausse encaissée sur la collecte du 22/08 (complément daté du 22/08), changement daté du 25/08 :
    annuler la journée du 25/08 défait le changement mais garde le complément."""
    b = collecte
    k = b.carnet(CARNET)
    b.saisir_reel(k["zoneId"], jour=J_RETARD)
    assert changer(b, b.caissier, 1000, jour=J_RETARD) == "OK"  # complément 6 000 F daté du 22/08
    b.ok(b.admin, "annulerOuvertureJourneeCaisse", {"employeId": b.caissier})
    d = b.etat()
    k = b.carnet(CARNET, d)
    actifs = [t for t in d["transactions"] if t["type"] == "complement_mise" and not t.get("annulee")]
    verifier_argent(b)


def test_annulation_journee_d_une_autre_agence_apres_baisse_par_l_admin(banc):
    """Baisse faite par l'admin (agence A) sur un carnet de l'agence B, puis annulation de la journée de B."""
    b = banc
    d = b.etat()
    caissier_b = next(e for e in d["employes"] if e["role"] == "caissier" and e["agenceId"] != b.agence)
    compte_b = M.compte_caisse_agence(d["comptesCaisse"], caissier_b["agenceId"])
    b.ok(b.admin, "ouvrirJourneeCaisse", {"employeId": caissier_b["id"], "soldeOuverture": compte_b["solde"]})
    (baisse,) = faire(b, b.admin, "changerMiseCarnet", {"carnetId": b.carnet("030002")["id"], "nouvelleMise": 1500})
    b.ok(b.admin, "annulerOuvertureJourneeCaisse", {"employeId": caissier_b["id"]})
    d = b.etat()
    k = b.carnet("030002", d)
    tx = next(t for t in d["transactions"] if t["id"] == baisse["id"]) if any(
        t["id"] == baisse["id"] for t in d["transactions"]) else None
    verifier_argent(b, "030002")
    assert tx is None or tx.get("annulee"), "ligne « Réduction de mise » orpheline restée active au journal"


def test_annulation_journee_en_retard_apres_une_hausse_sur_cette_collecte(collecte):
    """Hausse encaissée sur la collecte du 22/08, puis annulation de la journée du 22/08 : le complément
    part et la mise revient à 500, mais le changement (daté du 25/08) reste dans l'historique."""
    b = collecte
    k = b.carnet(CARNET)
    b.saisir_reel(k["zoneId"], jour=J_RETARD)
    assert changer(b, b.caissier, 1000, jour=J_RETARD) == "OK"
    b.ok(b.admin, "annulerOuvertureJourneeCaisse", {"employeId": b.caissier, "journee": J_RETARD})
    d = b.etat()
    k = b.carnet(CARNET, d)
    verifier_argent(b)
    assert k["historiqueMises"] == [], "changement orphelin : les dépôts du cycle ne s'annulent plus"


def test_annulation_journee_en_retard_rouvre_un_cycle_avant_changement(collecte):
    """Dépôt qui remplit le cycle 1 sur la collecte du 22/08, hausse aujourd'hui sur le cycle 2 vide : annuler
    la journée du 22/08 rouvrirait le cycle 1 (mise 500) alors que la mise est à 1 000 -> refusé."""
    b = collecte
    k = b.carnet(CARNET)
    b.saisir_reel(k["zoneId"], jour=J_RETARD)
    assert b.deposer(k, 19, jour=J_RETARD) == "OK"
    assert changer(b, b.caissier, 1000) == "OK"
    assert "a été changée après des opérations de cette journée" in b.run(
        b.admin, "annulerOuvertureJourneeCaisse", {"employeId": b.caissier, "journee": J_RETARD})
    assert cycle_en_cours(b) == 2
    verifier_argent(b)


# ---------------------------------------------------------------------------------------------
# 8 bis. Hausse après un retrait partiel (complément calculé sur les carreaux déjà retirés)
# ---------------------------------------------------------------------------------------------

def test_hausse_apres_retrait_partiel(collecte):
    b = collecte
    k = b.carnet(CARNET)
    b.ok(b.admin, "retraitCycle", {"carnetId": k["id"], "cycle": 1, "nombreCarreaux": 3})
    txs = faire(b, b.caissier, "changerMiseCarnet", {"carnetId": k["id"], "nouvelleMise": 1000, "dateCollecte": b.horloge.jour})
    verifier_argent(b)  # 12 × 500 - 3 × 500 + complément = 9 carreaux × 1 000 ?


# ---------------------------------------------------------------------------------------------
# 8 ter. Droits
# ---------------------------------------------------------------------------------------------

def test_baisse_par_le_chef_d_une_autre_agence(collecte):
    b = collecte
    k = b.carnet("030002")  # agence B
    assert k["agenceId"] != b.agence
    resultat = changer(b, b.chef, 1500, numero="030002")
    assert resultat != "OK", "le chef de l'agence A a réduit la mise d'un carnet de l'agence B"


# ---------------------------------------------------------------------------------------------
# 9. Export / import CSV
# ---------------------------------------------------------------------------------------------

def test_export_import_csv_conserve_l_historique(collecte):
    from app import backup
    b = collecte
    assert b.deposer(b.carnet(CARNET), 3) == "OK"
    assert changer(b, b.chef, 250) == "OK"
    avant = b.etat()
    k0 = b.carnet(CARNET, avant)
    raw, _ = backup.export_zip_bytes(b.db)
    backup.import_zip_bytes(b.db, raw)
    apres = b.etat()
    k1 = b.carnet(CARNET, apres)
    assert k1["historiqueMises"] == k0["historiqueMises"]
    lignes0 = sorted((m["id"], m.get("transactionId"), m["nombreMises"], float(m["montant"])) for m in avant["mises"])
    lignes1 = sorted((m["id"], m.get("transactionId"), m["nombreMises"], float(m["montant"])) for m in apres["mises"])
    assert lignes0 == lignes1
    verifier_argent(b)
    # Les garde-fous fonctionnent toujours après import
    baisse = next(t for t in apres["transactions"] if t["type"] == "reduction_mise")
    dep = next(t for t in apres["transactions"] if t["type"] == "mise_tontine" and t["date"][:10] == b.horloge.jour)
    assert "Annulez d'abord ce changement de mise" in annuler(b, dep)
    assert annuler(b, baisse) == "OK"
    verifier_argent(b)
