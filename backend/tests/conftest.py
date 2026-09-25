"""Banc d'essai pytest.

- La base de démo (data/demo-seed.json) est construite une fois, comme au démarrage de l'API,
  dans un dossier temporaire ; chaque test en reçoit une copie neuve.
- La date du jour, l'heure et les identifiants générés sont figés (voir outils.Horloge).
- La vraie base (backend/data/app.db) n'est jamais utilisée.
"""
import os
import tempfile
from pathlib import Path

_MODELE = Path(tempfile.mkdtemp(prefix="tontine-tests-")) / "modele.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_MODELE.as_posix()}"
os.environ["SEED_DEMO_ON_STARTUP"] = "true"
os.environ["CREATE_DEFAULT_ACCOUNTS"] = "true"

import pytest  # noqa: E402

from tests.outils import Banc, Horloge, construire_base_demo  # noqa: E402

construire_base_demo()


@pytest.fixture
def modele() -> Path:
    """Base de démo de référence (ne pas modifier : copiez-la)."""
    return _MODELE


@pytest.fixture
def horloge(monkeypatch) -> Horloge:
    return Horloge().installer(monkeypatch)


@pytest.fixture
def banc(tmp_path, horloge) -> Banc:
    b = Banc.depuis_modele(_MODELE, tmp_path / "test.db", horloge)
    yield b
    b.fermer()


@pytest.fixture
def collecte(banc) -> Banc:
    """Caisse de l'agence ouverte aujourd'hui et montant réel saisi pour les zones de l'agence."""
    banc.ouvrir_journee()
    for z in banc.etat()["zones"]:
        if z["agenceId"] == banc.agence:
            banc.saisir_reel(z["id"])
    return banc
