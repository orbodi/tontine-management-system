"""Migrations versionnées (schéma + données).

Au démarrage, après create_all :

1. Migrations **schéma** encore absentes de `schema_migrations` (SQL idempotent).
2. Seed si la base est vide.
3. Migrations **données** encore absentes (copie de `app.db` dans `data/backups/` d’abord).

Chaque id (`001_…`) s’applique **une fois**. Les fonctions restent idempotentes
pour pouvoir réparer une sauvegarde ancienne à l’import sans rejouer l’historique.
Cette table n’est pas vidée par `replace_state` (réinit démo / import CSV).
"""
from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal

from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from .config import DATA_DIR, settings
from .db import (
    SessionLocal,
    engine,
    migrate_carnets_unicite_numero_type,
    migrate_comptes_frais_ouverture,
    migrate_clients_numero_banque,
    migrate_clients_zone_nullable,
    migrate_clients_origine_tontine,
    migrate_transactions_annulation,
)
from .models.entities import SchemaMigration

logger = logging.getLogger("app.migrations")

Kind = Literal["schema", "data"]


@dataclass(frozen=True)
class Migration:
    id: str
    kind: Kind
    description: str
    apply: Callable[..., None]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def sqlite_path() -> Path | None:
    url = settings.database_url
    if not url.startswith("sqlite:///"):
        return None
    raw = url.removeprefix("sqlite:///")
    path = Path(raw)
    if not path.is_absolute():
        path = (DATA_DIR.parent / path).resolve()
    return path


def _backup_sqlite(migration_id: str) -> Path | None:
    src = sqlite_path()
    if src is None or not src.is_file() or src.stat().st_size == 0:
        return None
    dest_dir = DATA_DIR / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = dest_dir / f"app-avant-{migration_id}-{stamp}.db"
    shutil.copy2(src, dest)
    logger.info("Sauvegarde SQLite avant %s : %s", migration_id, dest.name)
    return dest


def _applied_ids(db: Session) -> set[str]:
    return {row.id for row in db.query(SchemaMigration).all()}


def _record(db: Session, migration_id: str) -> None:
    db.add(SchemaMigration(id=migration_id, applied_at=_now_iso()))
    db.commit()


def _migrate_numeros_clients_zzxxxx(db: Session) -> None:
    from .engine import realigner_numeros_persist

    realigner_numeros_persist(db)


def _migrate_caisse_unique_agence(db: Session) -> None:
    from .engine import consolider_caisses_agence_persist

    consolider_caisses_agence_persist(db)


def _migrate_numeros_clients_banque(db: Session) -> None:
    from .engine import attribuer_numeros_clients_banque_persist

    attribuer_numeros_clients_banque_persist(db)


MIGRATIONS: tuple[Migration, ...] = (
    Migration(
        id="001_comptes_frais_ouverture",
        kind="schema",
        description="Colonnes part sociale / droit d’adhésion / promotion sur comptes",
        apply=migrate_comptes_frais_ouverture,
    ),
    Migration(
        id="002_carnets_unicite_numero_type",
        kind="schema",
        description="Unicité carnet (numero, type_carnet) au lieu de numero seul",
        apply=migrate_carnets_unicite_numero_type,
    ),
    Migration(
        id="003_numeros_clients_zzxxxx",
        kind="data",
        description="N° client/carnet ZZxxxx (zone + rang) partagé par type de carnet",
        apply=_migrate_numeros_clients_zzxxxx,
    ),
    Migration(
        id="004_caisse_unique_agence",
        kind="data",
        description="Une caisse par agence ; le chef d'agence n'a pas de caisse",
        apply=_migrate_caisse_unique_agence,
    ),
    Migration(
        id="005_realigner_numeros_zzxxxx",
        kind="data",
        description="Réapplique ZZxxxx si l'ancien n° client (4 chiffres) est encore présent",
        apply=_migrate_numeros_clients_zzxxxx,
    ),
    Migration(
        id="006_clients_numero_banque",
        kind="schema",
        description="Colonnes n° client banque (ordre_banque / code_client_banque)",
        apply=migrate_clients_numero_banque,
    ),
    Migration(
        id="007_attribuer_numeros_clients_banque",
        kind="data",
        description="N° client banque 0001, 0002… au premier compte",
        apply=_migrate_numeros_clients_banque,
    ),
    Migration(
        id="008_clients_zone_nullable",
        kind="schema",
        description="Client banque rattaché à l’agence ; zone et n° tontine optionnels",
        apply=migrate_clients_zone_nullable,
    ),
    Migration(
        id="009_clients_origine_tontine",
        kind="schema",
        description="Client ancien (papier) : pas de 300 F ni de P.C. au 1er cycle",
        apply=migrate_clients_origine_tontine,
    ),
    Migration(
        id="010_transactions_annulation",
        kind="schema",
        description="Colonnes d'annulation (contrepassation) sur les transactions",
        apply=migrate_transactions_annulation,
    ),
)


def applied_migration_ids() -> list[str]:
    db = SessionLocal()
    try:
        return sorted(_applied_ids(db))
    finally:
        db.close()


def run_schema_migrations() -> list[str]:
    """Applique les migrations SQL encore non enregistrées."""
    db = SessionLocal()
    done: list[str] = []
    try:
        already = _applied_ids(db)
        for mig in MIGRATIONS:
            if mig.kind != "schema" or mig.id in already:
                continue
            with engine.begin() as conn:
                mig.apply(conn)
            _record(db, mig.id)
            done.append(mig.id)
            logger.info("Migration schéma %s : %s", mig.id, mig.description)
        return done
    finally:
        db.close()


def run_data_migrations() -> list[str]:
    """Applique les migrations de données encore non enregistrées."""
    db = SessionLocal()
    done: list[str] = []
    try:
        already = _applied_ids(db)
        for mig in MIGRATIONS:
            if mig.kind != "data" or mig.id in already:
                continue
            _backup_sqlite(mig.id)
            mig.apply(db)
            _record(db, mig.id)
            done.append(mig.id)
            logger.info("Migration données %s : %s", mig.id, mig.description)
        from .engine import load_state, numeros_clients_carnets_obsoletes, realigner_numeros_persist

        d = load_state(db, include_password_hashes=True)
        if numeros_clients_carnets_obsoletes(d):
            _backup_sqlite("003_numeros_clients_zzxxxx")
            realigner_numeros_persist(db)
            logger.info("Réparation n° clients : format ancien encore présent, réalignement ZZxxxx")
        return done
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def repair_data_after_replace(db: Session) -> None:
    """Répare les données après import / réinit (idempotent, hors journal des migrations)."""
    from .engine import (
        attribuer_numeros_clients_banque_persist,
        consolider_caisses_agence_persist,
        realigner_numeros_persist,
    )

    realigner_numeros_persist(db)
    attribuer_numeros_clients_banque_persist(db)
    consolider_caisses_agence_persist(db)
