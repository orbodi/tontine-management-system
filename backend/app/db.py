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


def migrate_clients_numero_banque(conn) -> None:
    """N° client banque (0001, 0002…) indépendant du n° tontine ZZxxxx."""
    try:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(clients)")).fetchall()}
    except Exception:  # noqa: BLE001
        return
    if "ordre_banque" not in cols:
        conn.execute(text("ALTER TABLE clients ADD COLUMN ordre_banque INTEGER"))
    if "code_client_banque" not in cols:
        conn.execute(text("ALTER TABLE clients ADD COLUMN code_client_banque VARCHAR"))


def migrate_clients_zone_nullable(conn) -> None:
    """Client banque : agence obligatoire, zone / n° tontine optionnels."""
    try:
        info = conn.execute(text("PRAGMA table_info(clients)")).fetchall()
    except Exception:  # noqa: BLE001
        return
    if not info:
        return
    cols = {row[1]: row for row in info}
    if "zone_id" not in cols:
        return
    zone_nn = int(cols["zone_id"][3] or 0)
    code_nn = int(cols.get("code_client", (0, 0, 0, 1))[3] or 0)
    ordre_nn = int(cols.get("ordre_zone", (0, 0, 0, 1))[3] or 0)
    if not zone_nn and not code_nn and not ordre_nn:
        return
    conn.execute(
        text(
            """
            CREATE TABLE clients_new (
                id VARCHAR PRIMARY KEY,
                code_client VARCHAR,
                agence_id VARCHAR,
                zone_id VARCHAR,
                ordre_zone INTEGER,
                nom VARCHAR,
                prenom VARCHAR,
                sexe VARCHAR,
                telephone VARCHAR,
                email VARCHAR,
                profession VARCHAR,
                adresse VARCHAR,
                piece_identite VARCHAR,
                date_inscription VARCHAR,
                actif BOOLEAN,
                ordre_banque INTEGER,
                code_client_banque VARCHAR,
                UNIQUE (code_client)
            )
            """
        )
    )
    has_banque = "ordre_banque" in cols
    if has_banque:
        conn.execute(
            text(
                """
                INSERT INTO clients_new (
                    id, code_client, agence_id, zone_id, ordre_zone,
                    nom, prenom, sexe, telephone, email, profession, adresse,
                    piece_identite, date_inscription, actif,
                    ordre_banque, code_client_banque
                )
                SELECT
                    id, NULLIF(code_client, ''), agence_id, NULLIF(zone_id, ''), ordre_zone,
                    nom, prenom, sexe, telephone, email, profession, adresse,
                    piece_identite, date_inscription, actif,
                    ordre_banque, code_client_banque
                FROM clients
                """
            )
        )
    else:
        conn.execute(
            text(
                """
                INSERT INTO clients_new (
                    id, code_client, agence_id, zone_id, ordre_zone,
                    nom, prenom, sexe, telephone, email, profession, adresse,
                    piece_identite, date_inscription, actif
                )
                SELECT
                    id, NULLIF(code_client, ''), agence_id, NULLIF(zone_id, ''), ordre_zone,
                    nom, prenom, sexe, telephone, email, profession, adresse,
                    piece_identite, date_inscription, actif
                FROM clients
                """
            )
        )
    conn.execute(text("DROP TABLE clients"))
    conn.execute(text("ALTER TABLE clients_new RENAME TO clients"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clients_agence_id ON clients (agence_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clients_zone_id ON clients (zone_id)"))


def migrate_transactions_annulation(conn) -> None:
    """Colonnes d'annulation (contrepassation) sur le journal des transactions."""
    try:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(transactions)")).fetchall()}
    except Exception:  # noqa: BLE001
        return
    alters = []
    if "annulee" not in cols:
        alters.append("ALTER TABLE transactions ADD COLUMN annulee BOOLEAN DEFAULT 0")
    if "motif_annulation" not in cols:
        alters.append("ALTER TABLE transactions ADD COLUMN motif_annulation TEXT")
    if "date_annulation" not in cols:
        alters.append("ALTER TABLE transactions ADD COLUMN date_annulation VARCHAR")
    if "annule_par_id" not in cols:
        alters.append("ALTER TABLE transactions ADD COLUMN annule_par_id VARCHAR")
    if "annule_par_nom" not in cols:
        alters.append("ALTER TABLE transactions ADD COLUMN annule_par_nom VARCHAR")
    for sql in alters:
        conn.execute(text(sql))


def migrate_clients_origine_tontine(conn) -> None:
    """Client ancien (papier) : origine_tontine + reprise_papier sur les carnets."""
    try:
        cols_c = {row[1] for row in conn.execute(text("PRAGMA table_info(clients)")).fetchall()}
        cols_k = {row[1] for row in conn.execute(text("PRAGMA table_info(carnets)")).fetchall()}
    except Exception:  # noqa: BLE001
        return
    if "origine_tontine" not in cols_c:
        conn.execute(text("ALTER TABLE clients ADD COLUMN origine_tontine VARCHAR DEFAULT 'nouveau'"))
    if "reprise_papier" not in cols_k:
        conn.execute(text("ALTER TABLE carnets ADD COLUMN reprise_papier BOOLEAN DEFAULT 0"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
