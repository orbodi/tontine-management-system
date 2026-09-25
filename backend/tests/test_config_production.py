"""Réglages : en production (ENVIRONNEMENT=production), l'API refuse de démarrer avec une configuration
de développement et n'accepte que les origines CORS explicites ; en dev, rien ne change.

Les réglages sont relus sans backend/.env ; les valeurs passées au constructeur priment sur les
variables d'environnement (conftest.py en fixe certaines)."""
import re

import pytest
from pydantic import ValidationError

from app.config import Settings

CLE = "cle-d-exemple-pour-les-tests-0123456789abcdef"  # plus de 32 caractères
ORIGINE = "https://tontine.example.org"
ORIGINE_LAN = "http://192.168.1.20:5173"


def reglages(**valeurs) -> Settings:
    return Settings(_env_file=None, **valeurs)


def reglages_production(**surcharges) -> Settings:
    """Configuration de production valide, modifiée par `surcharges`."""
    valeurs = dict(
        environnement="production",
        secret_key=CLE,
        seed_demo_on_startup=False,
        create_default_accounts=False,
        admin_password="Admin-mot-de-passe-fort",
        chef_password="Chef-mot-de-passe-fort",
        caisse_password="Caisse-mot-de-passe-fort",
        cors_origins=ORIGINE,
    )
    valeurs.update(surcharges)
    return reglages(**valeurs)


def refus(**surcharges) -> str:
    with pytest.raises(ValidationError) as exc:
        reglages_production(**surcharges)
    return str(exc.value)


# ---------------------------------------------------------------------------------------------
# Production
# ---------------------------------------------------------------------------------------------

def test_production_valide_demarre():
    s = reglages_production()
    assert s.est_production
    assert s.cors_origin_list == [ORIGINE]
    assert s.cors_origin_regex is None, "pas d'origines du réseau local en production"


@pytest.mark.parametrize("surcharges, variable", [
    ({"secret_key": "dev-secret-change-me-don-de-dieu-poc"}, "SECRET_KEY"),
    ({"secret_key": "x" * 31}, "SECRET_KEY"),
    ({"seed_demo_on_startup": True}, "SEED_DEMO_ON_STARTUP"),
    ({"create_default_accounts": True}, "CREATE_DEFAULT_ACCOUNTS"),
    ({"admin_password": "admin123"}, "ADMIN_PASSWORD"),
    ({"chef_password": "chef123"}, "CHEF_PASSWORD"),
    ({"caisse_password": "caisse123"}, "CAISSE_PASSWORD"),
    ({"admin_password": "caisse123"}, "ADMIN_PASSWORD"),
])
def test_production_refuse_une_configuration_de_dev(surcharges, variable):
    message = refus(**surcharges)
    assert "Démarrage refusé" in message
    assert variable in message


def test_clef_de_32_caracteres_acceptee():
    assert reglages_production(secret_key="x" * 32).est_production


def test_refus_liste_tous_les_problemes_sans_recopier_les_secrets():
    message = refus(secret_key="cle-secrete-trop-courte", seed_demo_on_startup=True, chef_password="chef123")
    for variable in ("SECRET_KEY", "SEED_DEMO_ON_STARTUP", "CHEF_PASSWORD"):
        assert variable in message
    assert "cle-secrete-trop-courte" not in message
    assert "Admin-mot-de-passe-fort" not in message


def test_mots_de_passe_par_defaut_non_configures_refuses(monkeypatch):
    # Sans ADMIN_PASSWORD / CHEF_PASSWORD / CAISSE_PASSWORD, les valeurs par défaut (admin123…) s'appliquent
    for variable in ("ADMIN_PASSWORD", "CHEF_PASSWORD", "CAISSE_PASSWORD"):
        monkeypatch.delenv(variable, raising=False)
    with pytest.raises(ValidationError) as exc:
        reglages(environnement="production", secret_key=CLE, seed_demo_on_startup=False,
                 create_default_accounts=False)
    assert all(v in str(exc.value) for v in ("ADMIN_PASSWORD", "CHEF_PASSWORD", "CAISSE_PASSWORD"))


def test_production_lue_dans_les_variables_d_environnement(monkeypatch):
    monkeypatch.setenv("ENVIRONNEMENT", "production")
    monkeypatch.setenv("SEED_DEMO_ON_STARTUP", "true")
    with pytest.raises(ValidationError) as exc:
        reglages()
    assert "SEED_DEMO_ON_STARTUP" in str(exc.value)


@pytest.mark.parametrize("valeur", ["prod", "preprod", ""])
def test_environnement_inconnu_refuse(valeur):
    with pytest.raises(ValidationError) as exc:
        reglages(environnement=valeur)
    assert "ENVIRONNEMENT" in str(exc.value)


def test_environnement_normalise():
    assert reglages_production(environnement=" Production ").est_production


# ---------------------------------------------------------------------------------------------
# Dev : comportement inchangé
# ---------------------------------------------------------------------------------------------

def test_dev_par_defaut(monkeypatch):
    monkeypatch.delenv("ENVIRONNEMENT", raising=False)
    s = reglages()
    assert s.environnement == "dev"
    assert not s.est_production


def test_dev_accepte_la_configuration_de_dev():
    s = reglages(
        environnement="dev",
        secret_key="dev-secret-change-me-don-de-dieu-poc",
        seed_demo_on_startup=True,
        create_default_accounts=True,
        admin_password="admin123",
        chef_password="chef123",
        caisse_password="caisse123",
    )
    assert not s.est_production
    assert s.seed_demo_on_startup and s.create_default_accounts


def test_dev_accepte_les_origines_du_reseau_local():
    s = reglages(environnement="dev")
    assert s.cors_origin_regex is not None
    assert re.fullmatch(s.cors_origin_regex, ORIGINE_LAN)
