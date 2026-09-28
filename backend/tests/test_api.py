"""Couche HTTP (FastAPI) : compression des réponses et échec d'écriture renvoyé comme une erreur d'action.

L'application est appelée sans son démarrage (lifespan) ; ses sessions visent la copie de base du banc.
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import engine as E
from app.db import get_db
from app.main import create_app
from app.security import create_access_token


@pytest.fixture
def client(banc):
    app = create_app()

    def session_du_banc():
        s = banc.Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = session_du_banc
    jeton = create_access_token(banc.admin, {"role": "admin"})
    c = TestClient(app, headers={"Authorization": f"Bearer {jeton}"})
    yield c
    c.close()


def test_grosse_reponse_compressee(client, banc):
    r = client.get("/api/data", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert len(r.json()["clients"]) == len(banc.etat()["clients"])  # décompressée par le client HTTP


def test_petite_reponse_non_compressee(client):
    r = client.get("/api/parametres/ouverture-compte", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers  # moins de 1000 octets


def test_sans_gzip_accepte_pas_de_compression(client):
    r = client.get("/api/data", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers


def test_ecriture_impossible_pas_d_erreur_500(client, banc, monkeypatch):
    carnet = next(k["id"] for k in banc.etat()["carnets"] if not k["verrouille"])

    def ecriture_impossible(*_a, **_k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(E, "replace_state", ecriture_impossible)
    r = client.post("/api/mutations/basculerVerrouCarnet", json={"payload": {"id": carnet}})
    assert r.status_code == 200
    assert r.json() == {"erreur": "Enregistrement impossible, réessayez."}
    assert not next(k for k in banc.etat()["carnets"] if k["id"] == carnet)["verrouille"]
