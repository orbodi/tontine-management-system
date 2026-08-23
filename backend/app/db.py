from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def migrate_schema() -> None:
    """Ajoute les colonnes manquantes (SQLite) sans perte de données."""
    with engine.begin() as conn:
        try:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(comptes)")).fetchall()}
        except Exception:  # noqa: BLE001
            return
        alters = []
        if "part_sociale" not in cols:
            alters.append("ALTER TABLE comptes ADD COLUMN part_sociale FLOAT DEFAULT 0")
        if "droit_adhesion" not in cols:
            alters.append("ALTER TABLE comptes ADD COLUMN droit_adhesion FLOAT DEFAULT 0")
        if "promotion" not in cols:
            alters.append("ALTER TABLE comptes ADD COLUMN promotion BOOLEAN DEFAULT 0")
        for sql in alters:
            conn.execute(text(sql))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
