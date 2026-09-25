"""Actions simultanées : chacune doit être enregistrée, sans erreur ni écrasement.

Chaque action relit toute la base puis la réécrit entièrement : sans protection, deux actions simultanées
se marchent dessus (« database is locked », ou la seconde efface la première). Le test tente de forcer ce
croisement (toutes les actions lisent avant que la première n'écrive). Depuis l'étape 0 du chantier
API <-> base, les actions sont sérialisées (db.verrou_ecriture) : le croisement est impossible, chaque
action attend la précédente (la barrière expire au bout de 2 s, puis les actions passent une à une).
"""
import threading

from app import engine as E


def test_actions_simultanees_toutes_enregistrees(banc, monkeypatch):
    carnets = [k["id"] for k in banc.etat()["carnets"] if not k["verrouille"]][:4]
    barriere = threading.Barrier(len(carnets))
    deja = threading.local()
    lire = E.load_state

    def lecture_croisee(db, **kw):
        etat = lire(db, **kw)
        if not getattr(deja, "fait", False):  # seulement la lecture initiale de chaque action
            deja.fait = True
            try:
                barriere.wait(timeout=2)
            except threading.BrokenBarrierError:
                pass
        return etat

    monkeypatch.setattr(E, "load_state", lecture_croisee)
    erreurs: dict[str, str] = {}

    def verrouiller(carnet_id):
        session = banc.Session()
        try:
            r = E.run_mutation(session, banc.admin, "basculerVerrouCarnet", {"id": carnet_id})
            if r.get("erreur"):
                erreurs[carnet_id] = r["erreur"]
        except Exception as exc:  # noqa: BLE001
            erreurs[carnet_id] = f"{type(exc).__name__}: {exc}"
        finally:
            session.close()

    fils = [threading.Thread(target=verrouiller, args=(k,)) for k in carnets]
    for f in fils:
        f.start()
    for f in fils:
        f.join(timeout=120)
    monkeypatch.undo()

    assert erreurs == {}
    verrouilles = {k["id"] for k in banc.etat()["carnets"] if k["verrouille"]}
    assert set(carnets) <= verrouilles, "une action simultanée a été écrasée"


def test_connexion_pendant_une_action_garde_sa_ligne_de_journal(banc, monkeypatch):
    """La réécriture complète d'une action en cours n'efface pas la ligne de journal d'une connexion."""
    from app.config import settings
    from app.routers import auth

    carnet = next(k["id"] for k in banc.etat()["carnets"] if not k["verrouille"])
    avant = len(banc.etat()["journalConnexions"])
    lue, connecte = threading.Event(), threading.Event()
    lire = E.load_state

    def lecture_puis_pause(db, **kw):
        etat = lire(db, **kw)
        if not lue.is_set():  # lecture initiale de l'action : la connexion arrive entre lecture et écriture
            lue.set()
            connecte.wait(timeout=1)
        return etat

    monkeypatch.setattr(E, "load_state", lecture_puis_pause)
    resultat: dict = {}

    def action():
        session = banc.Session()
        try:
            resultat.update(E.run_mutation(session, banc.admin, "basculerVerrouCarnet", {"id": carnet}))
        finally:
            session.close()

    fil = threading.Thread(target=action)
    fil.start()
    assert lue.wait(timeout=10)
    session = banc.Session()
    try:
        auth.login(auth.LoginRequest(identifiant=settings.admin_identifiant, motDePasse=settings.admin_password), db=session)
    finally:
        session.close()
        connecte.set()
    fil.join(timeout=60)

    assert resultat.get("ok"), resultat
    d = banc.etat()
    assert next(k for k in d["carnets"] if k["id"] == carnet)["verrouille"]
    assert len(d["journalConnexions"]) == avant + 1, "la ligne de journal de la connexion a été effacée"


def test_employe_relu_sous_le_verrou(banc):
    """L'état est relu en base sous le verrou, pas dans le cache de la session : un employé déjà chargé
    (ex. à l'authentification, avant d'attendre le verrou) puis modifié entre-temps par une autre action
    n'est pas remis dans son ancien état par la réécriture complète."""
    from app.repository import get_employe

    carnet = next(k["id"] for k in banc.etat()["carnets"] if not k["verrouille"])
    session = banc.Session()
    try:
        charge = get_employe(session, banc.admin)  # gardé en cache par la session tant qu'il est référencé
        banc.ok(banc.admin, "modifierEmploye", {"id": banc.admin, "patch": {"telephone": "90 00 00 01"}})
        assert E.run_mutation(session, banc.admin, "basculerVerrouCarnet", {"id": carnet}).get("ok")
    finally:
        session.close()
    assert charge.id == banc.admin
    admin = next(e for e in banc.etat()["employes"] if e["id"] == banc.admin)
    assert admin["telephone"] == "90 00 00 01"


def test_verrou_reentrant_reinitialiser_demo(banc):
    """reinitialiserDemo réécrit la base puis la répare (autres écritures) sous le même verrou : pas de blocage."""
    resultat: dict = {}
    fil = threading.Thread(
        target=lambda: resultat.update(E.run_mutation(banc.db, banc.admin, "reinitialiserDemo", {})), daemon=True
    )
    fil.start()
    fil.join(timeout=120)
    assert not fil.is_alive(), "reinitialiserDemo bloqué sur le verrou d'écriture"
    assert resultat.get("ok"), resultat
