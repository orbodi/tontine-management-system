"""Outils communs aux tests et aux scripts de mesure.

Important : DATABASE_URL doit être défini AVANT d'importer ce module (l'application crée sa connexion
à l'import). Les tests le font dans conftest.py ; les scripts le font avant leurs imports.
Aucun de ces outils ne doit viser la vraie base (backend/data/app.db).
"""
from __future__ import annotations

import shutil
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import engine as E
from app import metier as M
from app import migrations
from app.repository import load_state

# Jour « aujourd'hui » des tests : après la dernière journée de la démo (22/08, ouverte non clôturée)
JOUR_TEST = "2026-08-25"

# Modes d'écriture en base comparés par test_equivalence.py. Aujourd'hui seule la réécriture complète
# existe ; l'étape 1 du chantier API <-> base (écriture différentielle) ajoutera son mode ici et dans
# persistance() ci-dessous.
MODES_PERSISTANCE = ["complete"]


@contextmanager
def persistance(mode: str):
    """Active un mode d'écriture en base pendant le bloc."""
    if mode not in MODES_PERSISTANCE:
        raise ValueError(f"Mode de persistance inconnu : {mode}")
    yield


# ---------------------------------------------------------------------------------------------
# Base de démo, construite comme au démarrage de l'API
# ---------------------------------------------------------------------------------------------

def construire_base_demo() -> None:
    """Crée la base pointée par DATABASE_URL : tables, migrations, démo, comptabilité, réparations."""
    from app.comptabilite import ensure_comptabilite_seed
    from app.db import Base, SessionLocal, engine
    from app.seed import ensure_startup_data

    sauvegarde = migrations._backup_sqlite
    migrations._backup_sqlite = lambda *_a, **_k: None  # pas de copie dans backend/data/backups
    try:
        Base.metadata.create_all(bind=engine)
        migrations.run_schema_migrations()
        db = SessionLocal()
        try:
            ensure_startup_data(db)
            ensure_comptabilite_seed(db)
        finally:
            db.close()
        migrations.run_data_migrations()
    finally:
        migrations._backup_sqlite = sauvegarde
        engine.dispose()


# ---------------------------------------------------------------------------------------------
# Horloge et identifiants figés : deux exécutions du même scénario donnent la même base
# ---------------------------------------------------------------------------------------------

class Horloge:
    """Date du jour fixe ; chaque lecture de l'heure avance d'une seconde (ordre stable)."""

    def __init__(self, jour: str = JOUR_TEST):
        self.jour = jour
        self._secondes = 0
        self._ids = 0

    def aujourd_hui_iso(self) -> str:
        return self.jour

    def maintenant(self) -> str:
        self._secondes += 1
        h, reste = divmod(8 * 3600 + self._secondes, 3600)
        m, s = divmod(reste, 60)
        return f"{self.jour}T{h:02d}:{m:02d}:{s:02d}.000000"

    def uid(self) -> str:
        self._ids += 1
        return f"t{self._ids:015d}"

    def passer_au(self, jour: str) -> None:
        self.jour = jour
        self._secondes = 0

    def installer(self, monkeypatch) -> "Horloge":
        monkeypatch.setattr(M, "aujourd_hui_iso", self.aujourd_hui_iso)
        monkeypatch.setattr(M, "maintenant", self.maintenant)
        monkeypatch.setattr(E, "uid", self.uid)
        return self


# ---------------------------------------------------------------------------------------------
# Banc d'essai : une copie de base + raccourcis métier
# ---------------------------------------------------------------------------------------------

def ouvrir_session(chemin: Path) -> tuple[Any, sessionmaker]:
    moteur = create_engine(f"sqlite:///{Path(chemin).as_posix()}", connect_args={"check_same_thread": False})
    return moteur, sessionmaker(bind=moteur, autoflush=False)


@dataclass
class Banc:
    chemin: Path
    horloge: Horloge
    moteur: Any = None
    Session: sessionmaker | None = None
    db: Session | None = None
    ids: dict[str, str] = field(default_factory=dict)

    @classmethod
    def depuis_modele(cls, modele: Path, chemin: Path, horloge: Horloge) -> "Banc":
        shutil.copy2(modele, chemin)
        banc = cls(chemin=chemin, horloge=horloge)
        banc.moteur, banc.Session = ouvrir_session(chemin)
        banc.db = banc.Session()
        d = banc.etat()
        chef = next(e for e in d["employes"] if e["role"] == "chef_agence" and e["actif"])
        banc.ids = {
            "admin": next(e["id"] for e in d["employes"] if e["role"] == "admin" and e["actif"]),
            "chef": chef["id"],
            "caissier": next(
                e["id"] for e in d["employes"]
                if e["role"] == "caissier" and e["actif"] and e["agenceId"] == chef["agenceId"]
            ),
            "agence": chef["agenceId"],
        }
        return banc

    def fermer(self) -> None:
        if self.db is not None:
            self.db.close()
        if self.moteur is not None:
            self.moteur.dispose()

    # Raccourcis rôles
    @property
    def admin(self) -> str:
        return self.ids["admin"]

    @property
    def chef(self) -> str:
        return self.ids["chef"]

    @property
    def caissier(self) -> str:
        return self.ids["caissier"]

    @property
    def agence(self) -> str:
        return self.ids["agence"]

    # Actions
    def run(self, user: str, action: str, payload: dict | None = None) -> str:
        """« OK » ou le message d'erreur de l'action."""
        r = E.run_mutation(self.db, user, action, payload or {})
        return r.get("erreur") or "OK"

    def ok(self, user: str, action: str, payload: dict | None = None) -> dict:
        r = E.run_mutation(self.db, user, action, payload or {})
        assert not r.get("erreur"), f"{action} refusé : {r['erreur']}"
        return r

    def etat(self) -> dict:
        return load_state(self.db)

    # Lecture de l'état
    def compte_caisse(self, d: dict | None = None) -> dict:
        d = d or self.etat()
        return M.compte_caisse_agence(d["comptesCaisse"], self.agence)

    def arret(self, jour: str, d: dict | None = None) -> dict | None:
        d = d or self.etat()
        return M.arret_caisse_agence(d["arretsCaisse"], self.agence, jour)

    def theorique(self, jour: str, d: dict | None = None) -> float:
        d = d or self.etat()
        return M.situation_caisse(
            self.caissier, d["transactions"], d["arretsCaisse"], jour, d["comptesCaisse"],
            d["mouvementsCompteCaisse"], d["ouverturesCaisse"], d["employes"],
        )["soldeFermetureTheorique"]

    def fin_de_journee(self, jour: str, d: dict | None = None) -> float:
        d = d or self.etat()
        return M.solde_caisse_fin_journee(self.compte_caisse(d), d["mouvementsCompteCaisse"], jour)

    def carnet(self, numero: str, d: dict | None = None) -> dict:
        """Carnet par numéro (unique avec le type ; les numéros de la démo sont tous distincts)."""
        d = d or self.etat()
        return next(c for c in d["carnets"] if c["numero"] == numero)

    def compte(self, numero: str, d: dict | None = None) -> dict:
        d = d or self.etat()
        return next(c for c in d["comptes"] if c["numero"] == numero)

    def nets(self, carnet_id: str, cycle: int, d: dict | None = None) -> int:
        d = d or self.etat()
        k = next(c for c in d["carnets"] if c["id"] == carnet_id)
        return M.carreaux_nets(k, d["mises"], cycle)

    # Mises en situation
    def ouvrir_journee(self, jour: str | None = None) -> None:
        payload = {"employeId": self.caissier, "soldeOuverture": self.compte_caisse()["solde"]}
        if jour:
            payload["journee"] = jour
        self.ok(self.chef, "ouvrirJourneeCaisse", payload)

    def saisir_reel(self, zone_id: str, jour: str | None = None, montant: float = 100_000) -> None:
        self.ok(self.caissier, "saisirMontantReelZone",
                {"zoneId": zone_id, "montantReel": montant, "dateIso": jour or self.horloge.jour})

    def deposer(self, carnet: dict, nombre: int, jour: str | None = None, user: str | None = None) -> str:
        return self.run(user or self.caissier, "encaisserCotisation",
                        {"carnetId": carnet["id"], "montant": nombre * carnet["mise"],
                         "dateCollecte": jour or self.horloge.jour})


def nouvelles_transactions(avant: dict, apres: dict) -> list[dict]:
    ids = {t["id"] for t in avant["transactions"]}
    return [t for t in apres["transactions"] if t["id"] not in ids]


# ---------------------------------------------------------------------------------------------
# Comparaison de deux bases, table par table
# ---------------------------------------------------------------------------------------------

def dump_base(chemin: Path) -> dict[str, dict[Any, dict]]:
    """Contenu complet de la base : {table: {clé de ligne: {colonne: valeur}}}."""
    con = sqlite3.connect(Path(chemin))
    try:
        tables = [
            r[0] for r in con.execute(
                "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"
            )
        ]
        out: dict[str, dict[Any, dict]] = {}
        for t in tables:
            cur = con.execute(f'select * from "{t}"')
            cols = [c[0] for c in cur.description]
            lignes = {}
            for row in cur.fetchall():
                ligne = dict(zip(cols, row))
                cle = ligne["id"] if "id" in ligne else tuple(repr(v) for v in row)
                lignes[cle] = ligne
            out[t] = lignes
        return out
    finally:
        con.close()


def comparer_bases(a: Path, b: Path, *, max_lignes: int = 30) -> list[str]:
    """Différences lisibles entre deux bases (vide = identiques)."""
    da, db_ = dump_base(a), dump_base(b)
    diffs: list[str] = []
    for t in sorted(set(da) | set(db_)):
        ta, tb = da.get(t, {}), db_.get(t, {})
        for cle in sorted(set(ta) | set(tb), key=repr):
            if cle not in tb:
                diffs.append(f"{t} : ligne {cle!r} seulement dans A")
            elif cle not in ta:
                diffs.append(f"{t} : ligne {cle!r} seulement dans B")
            elif ta[cle] != tb[cle]:
                cols = [c for c in ta[cle] if ta[cle][c] != tb[cle].get(c)]
                diffs.append(
                    f"{t} : ligne {cle!r} diffère sur " + ", ".join(f"{c} ({ta[cle][c]!r} ≠ {tb[cle][c]!r})" for c in cols)
                )
            if len(diffs) >= max_lignes:
                return diffs + ["…"]
    return diffs
