"""Configuration FastAPI / SQLite — chargée depuis backend/.env."""
from pathlib import Path
import json

from pydantic import computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

_DEFAULT_CORS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:4173,http://127.0.0.1:4173"
)

# Origines LAN (192.168/10/172.16-31) — front Vite / preview
_CORS_LAN_REGEX = (
    r"https?://("
    r"localhost|127\.0\.0\.1|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?"
)

ENVIRONNEMENTS = ("dev", "production")
_SECRET_KEY_DEV = "dev-secret-change-me-don-de-dieu-poc"
SECRET_KEY_LONGUEUR_MIN = 32
# Mots de passe des comptes par défaut (dev), interdits en production
_MOTS_DE_PASSE_PAR_DEFAUT = ("admin123", "chef123", "caisse123")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Jamais de SECRET_KEY / mot de passe recopié dans un message d'erreur de configuration
        hide_input_in_errors=True,
    )

    # « dev » (défaut) ou « production » : en production, la configuration est contrôlée au démarrage
    # (voir _verifier_production), le CORS se limite à CORS_ORIGINS et la réinitialisation démo est désactivée.
    environnement: str = "dev"

    app_name: str = "DON DE DIEU API"
    secret_key: str = _SECRET_KEY_DEV
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12
    database_url: str = f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}"
    # Liste séparée par des virgules (ou JSON array dans .env)
    cors_origins: str = _DEFAULT_CORS
    demo_seed_path: Path = DATA_DIR / "demo-seed.json"

    # Seed / bootstrap — sur `dev`, démo activée par défaut (surchargeable via .env)
    seed_demo_on_startup: bool = True
    create_default_accounts: bool = True

    # Comptes par défaut (créés si create_default_accounts et base vide)
    default_agence_code: str = "AG01"
    default_agence_nom: str = "Agence Principale"

    admin_identifiant: str = "admin"
    admin_password: str = "admin123"
    admin_nom: str = "Administrateur"

    chef_identifiant: str = "chef"
    chef_password: str = "chef123"
    chef_nom: str = "Chef d'agence"

    caisse_identifiant: str = "caisse"
    caisse_password: str = "caisse123"
    caisse_nom: str = "Caissier"

    # Frais d'ouverture compte courant / épargne (FCFA)
    part_sociale_montant: float = 5000
    droit_adhesion_montant: float = 2500
    droit_adhesion_promo_montant: float = 500

    @field_validator("environnement")
    @classmethod
    def _environnement_connu(cls, valeur: str) -> str:
        # Une faute de frappe (« prod ») ne doit pas démarrer silencieusement en mode dev
        valeur = (valeur or "").strip().lower()
        if valeur not in ENVIRONNEMENTS:
            raise ValueError("ENVIRONNEMENT doit valoir « dev » ou « production ».")
        return valeur

    @property
    def est_production(self) -> bool:
        return self.environnement == "production"

    @model_validator(mode="after")
    def _verifier_production(self) -> "Settings":
        """En production, refuse de démarrer tant qu'un réglage de dev est encore en place."""
        if not self.est_production:
            return self
        problemes: list[str] = []
        if self.secret_key == _SECRET_KEY_DEV:
            problemes.append("SECRET_KEY vaut la clé de développement par défaut : générez une clé aléatoire.")
        elif len(self.secret_key) < SECRET_KEY_LONGUEUR_MIN:
            problemes.append(f"SECRET_KEY doit faire au moins {SECRET_KEY_LONGUEUR_MIN} caractères.")
        if self.seed_demo_on_startup:
            problemes.append("SEED_DEMO_ON_STARTUP doit valoir false (pas de données de démo en production).")
        if self.create_default_accounts:
            problemes.append("CREATE_DEFAULT_ACCOUNTS doit valoir false (pas de comptes par défaut en production).")
        for variable, mot_de_passe in (
            ("ADMIN_PASSWORD", self.admin_password),
            ("CHEF_PASSWORD", self.chef_password),
            ("CAISSE_PASSWORD", self.caisse_password),
        ):
            if mot_de_passe in _MOTS_DE_PASSE_PAR_DEFAUT:
                problemes.append(f"{variable} vaut un mot de passe par défaut ({mot_de_passe}) : remplacez-le.")
        if problemes:
            raise ValueError(
                "Démarrage refusé, configuration de production non sûre (ENVIRONNEMENT=production) :\n- "
                + "\n- ".join(problemes)
            )
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw.startswith("["):
            parsed = json.loads(raw)
            return [str(x).strip() for x in parsed if str(x).strip()]
        return [part.strip() for part in raw.split(",") if part.strip()]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origin_regex(self) -> str | None:
        # En production : seulement les origines explicites de CORS_ORIGINS
        return None if self.est_production else _CORS_LAN_REGEX


settings = Settings()
