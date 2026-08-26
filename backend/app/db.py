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


def migrate_comptes_frais_ouverture(conn) -> None:
    """Ajoute part_sociale / droit_adhesion / promotion si absents."""
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


def migrate_carnets_unicite_numero_type(conn) -> None:
    """Passe l'unicité carnet de `numero` seul à `(numero, type_carnet)`."""
    try:
        tables = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
    except Exception:  # noqa: BLE001
        return
    if "carnets" not in tables:
        return
    indexes = conn.execute(text("PRAGMA index_list(carnets)")).fetchall()
    has_composite = False
    has_numero_seul = False
    for row in indexes:
        name, unique = row[1], row[2]
        if not unique:
            continue
        cols = [r[2] for r in conn.execute(text(f'PRAGMA index_info("{name}")')).fetchall()]
        if list(cols) == ["numero", "type_carnet"] or set(cols) == {"numero", "type_carnet"}:
            has_composite = True
        elif list(cols) == ["numero"]:
            has_numero_seul = True
    if has_composite and not has_numero_seul:
        return
    conn.execute(
        text(
            """
            CREATE TABLE carnets_new (
                id VARCHAR PRIMARY KEY,
                client_id VARCHAR,
                numero VARCHAR,
                zone_id VARCHAR,
                agence_id VARCHAR,
                type_carnet VARCHAR,
                mise FLOAT,
                frequence VARCHAR,
                mises_par_cycle INTEGER,
                cycle_actuel INTEGER,
                date_ouverture VARCHAR,
                verrouille BOOLEAN,
                retrait_active_par_admin BOOLEAN,
                actif BOOLEAN,
                UNIQUE (numero, type_carnet)
            )
            """
        )
    )
    conn.execute(
        text(
            """
            INSERT INTO carnets_new (
                id, client_id, numero, zone_id, agence_id, type_carnet, mise, frequence,
                mises_par_cycle, cycle_actuel, date_ouverture, verrouille,
                retrait_active_par_admin, actif
            )
            SELECT
                id, client_id, numero, zone_id, agence_id, type_carnet, mise, frequence,
                mises_par_cycle, cycle_actuel, date_ouverture, verrouille,
                retrait_active_par_admin, actif
            FROM carnets
            """
        )
    )
    conn.execute(text("DROP TABLE carnets"))
    conn.execute(text("ALTER TABLE carnets_new RENAME TO carnets"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_carnets_client_id ON carnets (client_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_carnets_numero ON carnets (numero)"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
