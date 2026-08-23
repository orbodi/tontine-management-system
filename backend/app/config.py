"""Configuration FastAPI / SQLite."""
from pathlib import Path

from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


class Settings(BaseSettings):
    app_name: str = "DON DE DIEU API"
    secret_key: str = "dev-secret-change-me-don-de-dieu-poc"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12
    database_url: str = f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    demo_seed_path: Path = DATA_DIR / "demo-seed.json"
    # True sur dev : charge demo-seed.json si la base est vide
    seed_demo_on_startup: bool = True


settings = Settings()
