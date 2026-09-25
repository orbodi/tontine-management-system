"""Actions simultanées : chacune doit être enregistrée, sans erreur ni écrasement.

Aujourd'hui chaque action relit toute la base puis la réécrit entièrement : deux actions simultanées
se marchent dessus (« database is locked », ou la seconde efface la première). Le test force ce
croisement (toutes les actions lisent avant que la première n'écrive) ; il est marqué « échec
attendu » jusqu'à l'étape 0 du chantier API <-> base (actions sérialisées). Une fois corrigé, il passe :
retirez alors le marqueur xfail (strict=True le signale).
"""
import threading

import pytest

from app import engine as E


@pytest.mark.xfail(strict=True, reason="Étape 0 du chantier API <-> base : actions simultanées pas encore sérialisées")
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
