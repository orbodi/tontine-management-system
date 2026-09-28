"""Réglages SQLite de l'API (mode WAL) et sauvegarde avant migration compatible WAL."""
import shutil
import sqlite3

from app import migrations
from app.db import engine


def test_connexion_api_en_wal():
    """Chaque connexion de l'API : journal WAL, attente de 30 s si la base est occupée, synchronous=NORMAL."""
    try:
        with engine.connect() as con:
            assert con.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
            assert con.exec_driver_sql("PRAGMA busy_timeout").scalar() == 30000
            assert con.exec_driver_sql("PRAGMA synchronous").scalar() == 1  # NORMAL
    finally:
        engine.dispose()


def test_base_de_demo_en_wal(modele):
    """Le mode WAL est enregistré dans le fichier : la base construite comme au démarrage (et ses copies) le garde."""
    con = sqlite3.connect(modele)
    try:
        assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        con.close()


def test_sauvegarde_avant_migration_inclut_le_wal(tmp_path, monkeypatch):
    """En WAL, les dernières écritures sont dans app.db-wal : la sauvegarde doit les contenir."""
    src = tmp_path / "app.db"
    con = sqlite3.connect(src)
    try:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA wal_autocheckpoint=0")  # rien n'est reporté dans app.db tant que la connexion vit
        con.execute("create table t (x integer)")
        con.execute("insert into t values (1)")
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # app.db contient la table et la 1re ligne
        con.execute("insert into t values (2)")  # 2e ligne : seulement dans app.db-wal
        con.commit()

        monkeypatch.setattr(migrations, "sqlite_path", lambda: src)
        monkeypatch.setattr(migrations, "DATA_DIR", tmp_path)
        sauvegarde = migrations._backup_sqlite("999_essai")
        assert sauvegarde is not None and sauvegarde.parent == tmp_path / "backups"

        copie = tmp_path / "copie.db"
        shutil.copy2(src, copie)  # ce que faisait l'ancienne sauvegarde
        assert _lignes(copie) == [(1,)], "la copie du seul fichier .db perd la dernière écriture"
        assert _lignes(sauvegarde) == [(1,), (2,)]
    finally:
        con.close()


def _lignes(chemin) -> list:
    con = sqlite3.connect(chemin)
    try:
        return con.execute("select x from t order by x").fetchall()
    finally:
        con.close()
