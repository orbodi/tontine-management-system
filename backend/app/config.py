"""Configuration FastAPI / SQLite — chargée depuis backend/.env."""
from pathlib import Path
import json

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

_DEFAULT_CORS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:4173,http://127.0.0.1:4173"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "DON DE DIEU API"
    secret_key: str = "dev-secret-change-me-don-de-dieu-poc"
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

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw.startswith("["):
            parsed = json.loads(raw)
            return [str(x).strip() for x in parsed if str(x).strip()]
        return [part.strip() for part in raw.split(",") if part.strip()]


settings = Settings()
