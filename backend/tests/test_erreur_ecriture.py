"""Échec de l'écriture en base : l'action renvoie une erreur (pas d'erreur 500) et la base n'a pas bougé."""
import logging
import sqlite3

from app import engine as E
from app import repository
from tests.outils import comparer_bases


def _copier(chemin, dest) -> None:
    """Copie cohérente (API de sauvegarde SQLite : inclut le fichier -wal)."""
    src, dst = sqlite3.connect(chemin), sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()


def test_ecriture_impossible_base_intacte(banc, tmp_path, monkeypatch, caplog):
    carnet = next(k["id"] for k in banc.etat()["carnets"] if not k["verrouille"])
    avant = tmp_path / "avant.db"
    _copier(banc.chemin, avant)

    def ecriture_interrompue(db, data, **kw):
        repository._clear_all(db)  # la réécriture a commencé (tables vidées)…
        raise sqlite3.OperationalError("disk I/O error")  # … puis échoue avant la fin

    with monkeypatch.context() as mp:
        mp.setattr(E, "replace_state", ecriture_interrompue)
        with caplog.at_level(logging.ERROR, logger="app.engine"):
            r = E.run_mutation(banc.db, banc.admin, "basculerVerrouCarnet", {"id": carnet})

    assert r == {"erreur": "Enregistrement impossible, réessayez."}
    assert "basculerVerrouCarnet" in caplog.text and "disk I/O error" in caplog.text
    assert comparer_bases(avant, banc.chemin) == []

    # La session reste utilisable : l'action suivante s'enregistre normalement
    banc.ok(banc.admin, "basculerVerrouCarnet", {"id": carnet})
    assert next(k for k in banc.etat()["carnets"] if k["id"] == carnet)["verrouille"]


def test_erreur_d_une_action_inchangee(banc):
    """Les erreurs métier restent renvoyées telles quelles (seul l'échec d'écriture est intercepté)."""
    assert banc.run(banc.caissier, "ajouterAgence", {"code": "ZZ", "nom": "Essai"}) == "Droit insuffisant."
