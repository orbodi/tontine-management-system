"""Sécurité de l'API HTTP : réinitialisation de la démo réservée à la route admin (et désactivée en
production), CORS de production, limite des tentatives de connexion.

Les appels passent par l'application FastAPI (TestClient) sur la copie de base du test ; le démarrage
de l'API (migrations, seed) n'est pas rejoué.
"""
import bcrypt
import pytest
from fastapi.testclient import TestClient

from app import models as m
from app.config import settings
from app.db import get_db
from app.main import app, create_app
from app.routers import auth
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


# ---------------------------------------------------------------------------------------------
# Mode production (ENVIRONNEMENT=production)
# ---------------------------------------------------------------------------------------------

@pytest.fixture
def production(monkeypatch):
    monkeypatch.setattr(settings, "environnement", "production")


def test_reinitialisation_desactivee_en_production(collecte, client, production):
    b = collecte
    avant = dump_base(b.chemin)

    r = client.post("/api/admin/reinitialiser-demo", headers=entetes(b, b.admin))

    assert r.status_code == 403
    assert "production" in r.json()["detail"]
    assert dump_base(b.chemin) == avant


@pytest.mark.parametrize("environnement, reseau_local_autorise", [("dev", True), ("production", False)])
def test_cors_reseau_local_seulement_en_dev(monkeypatch, environnement, reseau_local_autorise):
    monkeypatch.setattr(settings, "environnement", environnement)
    monkeypatch.setattr(settings, "cors_origins", "https://tontine.example.org")
    c = TestClient(create_app())  # main.py lit les réglages CORS à la création de l'application

    def autorisee(origine: str) -> bool:
        r = c.options("/api/health", headers={"Origin": origine, "Access-Control-Request-Method": "GET"})
        return r.headers.get("access-control-allow-origin") == origine

    assert autorisee("https://tontine.example.org")
    assert autorisee("http://192.168.1.20:5173") is reseau_local_autorise
    assert not autorisee("https://pirate.example.com")


# ---------------------------------------------------------------------------------------------
# Limite des tentatives de connexion (5 échecs par identifiant + adresse IP sur 15 minutes)
# ---------------------------------------------------------------------------------------------

MOT_DE_PASSE = "Bon-mot-de-passe-1"


@pytest.fixture
def identifiant(banc, client):
    """Identifiant du caissier du banc, avec un mot de passe connu ; compteur d'échecs vidé."""
    emp = banc.db.get(m.Employe, banc.caissier)
    emp.mot_de_passe_hash = bcrypt.hashpw(MOT_DE_PASSE.encode(), bcrypt.gensalt(rounds=4)).decode()
    banc.db.commit()
    auth._echecs_connexion.clear()
    yield emp.identifiant
    auth._echecs_connexion.clear()


def connexion(identifiant: str, mot_de_passe: str, ip: str = "10.0.0.1") -> int:
    r = TestClient(app, client=(ip, 50000)).post(
        "/api/auth/login", json={"identifiant": identifiant, "motDePasse": mot_de_passe})
    return r.status_code


def echouer(identifiant: str, fois: int = auth.MAX_ECHECS_CONNEXION, ip: str = "10.0.0.1") -> None:
    for _ in range(fois):
        assert connexion(identifiant, "mauvais", ip) == 401


def test_connexion_bloquee_apres_5_echecs_meme_avec_le_bon_mot_de_passe(identifiant):
    echouer(identifiant)

    r = TestClient(app, client=("10.0.0.1", 50000)).post(
        "/api/auth/login", json={"identifiant": identifiant, "motDePasse": MOT_DE_PASSE})

    assert r.status_code == 429
    assert "Trop de tentatives" in r.json()["detail"]
    assert "Réessayez dans" in r.json()["detail"]
    assert int(r.headers["Retry-After"]) <= auth.FENETRE_ECHECS_CONNEXION
    assert connexion(identifiant.upper(), MOT_DE_PASSE) == 429, "même identifiant, autre casse"


def test_limite_par_identifiant_et_adresse_ip(identifiant):
    echouer(identifiant)
    assert connexion(identifiant, MOT_DE_PASSE, ip="10.0.0.2") == 200, "autre adresse IP"
    assert connexion("inconnu", "mauvais") == 401, "autre identifiant"


def test_echecs_oublies_apres_15_minutes(identifiant):
    echouer(identifiant)
    assert connexion(identifiant, MOT_DE_PASSE) == 429
    for cle, echecs in auth._echecs_connexion.items():  # 15 minutes plus tard
        auth._echecs_connexion[cle] = [t - auth.FENETRE_ECHECS_CONNEXION for t in echecs]
    assert connexion(identifiant, MOT_DE_PASSE) == 200


def test_compteur_remis_a_zero_apres_une_connexion_reussie(identifiant):
    echouer(identifiant, auth.MAX_ECHECS_CONNEXION - 1)
    assert connexion(identifiant, MOT_DE_PASSE) == 200
    echouer(identifiant)
    assert connexion(identifiant, MOT_DE_PASSE) == 429
