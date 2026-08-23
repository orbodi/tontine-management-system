"""Génère backend/data/plan-comptable-syscohada.json depuis la liste LeFisk."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "sources" / "plan-comptable-syscohada-lefisk.md"
OUT = ROOT / "data" / "plan-comptable-syscohada.json"

# Comptes analytiques microfinance (n° libres, hors collision avec le plan officiel)
EXTRA = [
    {"numero": "4119", "intitule": "Clients — crédits microfinance", "classe": 4, "type": "actif"},
    {"numero": "4671", "intitule": "Dépôts à vue clients", "classe": 4, "type": "passif"},
    {"numero": "4672", "intitule": "Épargne clients", "classe": 4, "type": "passif"},
    {"numero": "4673", "intitule": "Collecte tontine à reverser", "classe": 4, "type": "passif"},
    {"numero": "4678", "intitule": "Commissions tontine à recevoir", "classe": 4, "type": "actif"},
    {"numero": "6589", "intitule": "Manquants de caisse", "classe": 6, "type": "charge"},
    {"numero": "7061", "intitule": "Commissions sur tontine", "classe": 7, "type": "produit"},
    {"numero": "7062", "intitule": "Commissions et frais de dossier", "classe": 7, "type": "produit"},
    {"numero": "7071", "intitule": "Vente de carnets tontine", "classe": 7, "type": "produit"},
    {"numero": "7589", "intitule": "Surplus de caisse", "classe": 7, "type": "produit"},
]


def infer_type(classe: int, numero: str) -> str:
    if classe == 1:
        if numero.startswith(("119", "129", "1309", "139", "109")):
            return "actif"
        return "passif"
    if classe == 2:
        if numero.startswith(("28", "29")):
            return "passif"
        return "actif"
    if classe == 3:
        if numero.startswith("39"):
            return "passif"
        return "actif"
    if classe == 4:
        if numero.startswith(("40", "42", "43", "44", "45", "419", "449")):
            return "passif"
        if numero.startswith(("471", "472", "473", "474", "475", "476", "477", "478", "479", "487")):
            return "passif"
        if numero.startswith(("41", "46", "47", "48", "49")):
            # 49 provisions = passif
            if numero.startswith("49"):
                return "passif"
            return "actif"
        return "passif"
    if classe == 5:
        if numero.startswith(("56", "564", "565")):
            return "passif"
        return "actif"
    if classe == 6:
        return "charge"
    if classe == 7:
        return "produit"
    return "hors"


def parse(text: str) -> list[dict]:
    classe = None
    accounts: list[dict] = []
    seen: set[str] = set()
    for line in text.splitlines():
        mcls = re.match(r"^CLASSE\s+(\d+)\s*:", line.strip(), re.I)
        if mcls:
            classe = int(mcls.group(1))
            continue
        m = re.match(r"^\|\s*([0-9]{1,6})\s*\|\s*(.+?)\s*\|\s*$", line.strip())
        if not m or classe is None:
            continue
        numero = m.group(1)
        intitule = re.sub(r"\s+", " ", m.group(2).strip())
        if numero in seen or intitule.startswith("---"):
            continue
        seen.add(numero)
        accounts.append(
            {
                "numero": numero,
                "intitule": intitule,
                "classe": classe,
                "type": infer_type(classe, numero),
            }
        )
    for extra in EXTRA:
        # Les comptes analytiques microfinance écrasent / complètent le plan officiel
        accounts = [a for a in accounts if a["numero"] != extra["numero"]]
        accounts.append(extra)
        seen.add(extra["numero"])
    accounts.sort(key=lambda a: (a["classe"], a["numero"]))
    return accounts


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    accounts = parse(text)
    OUT.write_text(json.dumps(accounts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(accounts)} accounts -> {OUT}")


if __name__ == "__main__":
    main()
