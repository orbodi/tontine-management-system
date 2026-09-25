"""Même scénario => même base, à la ligne près.

Avec un seul mode d'écriture, vérifie que le banc est déterministe. Quand l'écriture différentielle
sera ajoutée à MODES_PERSISTANCE (tests/outils.py), ce test prouvera qu'elle écrit exactement ce
qu'écrit la réécriture complète.
"""
import itertools
import sqlite3

import pytest

from tests.outils import MODES_PERSISTANCE, Banc, Horloge, comparer_bases, persistance
from tests.scenarios import scenario_complet


def _jouer(modele, chemin, mode, monkeypatch):
    with monkeypatch.context() as mp:
        banc = Banc.depuis_modele(modele, chemin, Horloge().installer(mp))
        try:
            with persistance(mode):
                scenario_complet(banc)
        finally:
            banc.fermer()
    return chemin


@pytest.mark.parametrize(("mode_a", "mode_b"), list(itertools.combinations_with_replacement(MODES_PERSISTANCE, 2)))
def test_meme_scenario_meme_base(modele, tmp_path, monkeypatch, mode_a, mode_b):
    a = _jouer(modele, tmp_path / "a.db", mode_a, monkeypatch)
    b = _jouer(modele, tmp_path / "b.db", mode_b, monkeypatch)
    assert len(comparer_bases(modele, a, max_lignes=100)) > 50, "le scénario doit réellement modifier la base"
    assert comparer_bases(a, b) == []


def test_le_comparateur_voit_une_difference(modele, tmp_path, monkeypatch):
    a = _jouer(modele, tmp_path / "a.db", MODES_PERSISTANCE[0], monkeypatch)
    b = tmp_path / "b.db"
    b.write_bytes(a.read_bytes())
    con = sqlite3.connect(b)
    con.execute("update comptes set solde = solde + 1 where numero = 'B0001'")
    con.execute("delete from mises where rowid = (select max(rowid) from mises)")
    con.commit()
    con.close()
    diffs = comparer_bases(a, b)
    assert any(d.startswith("comptes") and "solde" in d for d in diffs)
    assert any(d.startswith("mises") and "seulement dans A" in d for d in diffs)
