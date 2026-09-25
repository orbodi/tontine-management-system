"""Sécurité de l'API HTTP : réinitialisation de la démo réservée à la route admin.

Les appels passent par l'application FastAPI (TestClient) sur la copie de base du test ; le démarrage
de l'API (migrations, seed) n'est pas rejoué.
"""
import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.security import create_access_token
from tests.outils import JOUR_TEST, dump_base


@pytest.fixture
def client(banc):
    """Client HTTP dont les requêtes lisent et écrivent la base du banc."""
    def db_du_banc():
        db = banc.Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = db_du_banc
    yield TestClient(app)
    app.dependency_overrides.clear()


def entetes(banc, employe_id: str) -> dict[str, str]:
    """En-tête d'authentification d'un employé du banc (jeton signé comme au login)."""
    role = next(e["role"] for e in banc.etat()["employes"] if e["id"] == employe_id)
    return {"Authorization": f"Bearer {create_access_token(employe_id, {'role': role})}"}


def journee_ouverte(banc) -> bool:
    banc.db.expire_all()  # la base a pu être écrite par la session de l'API
    return any(o["journee"] == JOUR_TEST for o in banc.etat()["ouverturesCaisse"])


# ---------------------------------------------------------------------------------------------
# Réinitialisation de la démo (remplace toute la base)
# ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("role", ["caissier", "chef", "admin"])
def test_reinitialisation_refusee_par_le_point_d_entree_des_mutations(collecte, client, role):
    b = collecte
    assert journee_ouverte(b)
    avant = dump_base(b.chemin)

    r = client.post("/api/mutations/reinitialiserDemo", json={"payload": {}}, headers=entetes(b, b.ids[role]))

    assert r.status_code == 403
    assert "administrateur" in r.json()["detail"]
    assert dump_base(b.chemin) == avant, "la base a été modifiée"


def test_route_admin_de_reinitialisation_refusee_au_caissier(collecte, client):
    b = collecte
    avant = dump_base(b.chemin)
    r = client.post("/api/admin/reinitialiser-demo", headers=entetes(b, b.caissier))
    assert r.status_code == 403
    assert dump_base(b.chemin) == avant


def test_admin_reinitialise_la_demo_par_la_route_dediee_en_dev(collecte, client):
    b = collecte
    assert journee_ouverte(b)

    r = client.post("/api/admin/reinitialiser-demo", headers=entetes(b, b.admin))

    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    assert not journee_ouverte(b), "la base n'a pas été remplacée par la démo"
