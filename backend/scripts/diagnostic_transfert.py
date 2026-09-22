"""Diagnostic (lecture seule) : pourquoi le transfert tontine -> compte est bloqué.

Usage (depuis backend/) :  python scripts/diagnostic_transfert.py [chemin/app.db]
"""
import sqlite3
import sys
from pathlib import Path

db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "app.db"
if not db_path.exists():
    sys.exit(f"Base introuvable : {db_path}")

db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
q = lambda sql, *a: db.execute(sql, a).fetchall()  # noqa: E731

clients = {c["id"]: c for c in q("SELECT * FROM clients")}
comptes = q("SELECT * FROM comptes")
demandes = q("SELECT * FROM demandes_ouverture_compte")


def nom(c):
    return f"{(c['nom'] or '').strip()} {(c['prenom'] or '').strip()}".strip()


def cle(c):
    return nom(c).lower()


print(f"Base : {db_path}")
print(f"Clients {len(clients)} | comptes {len(comptes)} | demandes {len(demandes)}\n")

client_ids_carnet = sorted({r["client_id"] for r in q("SELECT client_id FROM carnets")})
for cid in client_ids_carnet:
    c = clients.get(cid)
    if not c:
        print(f"[?] Carnet rattaché à un client inexistant ({cid})\n")
        continue
    ses_comptes = [x for x in comptes if x["client_id"] == cid]
    ok = [x for x in ses_comptes if not x["verrouille"]]
    print(f"{'OK ' if ok else 'KO '} {nom(c)}  (id={cid}, n° tontine={c['code_client']}, n° banque={c['code_client_banque']})")
    if ok:
        print()
        continue
    for x in ses_comptes:
        print(f"     - compte {x['numero']} ({x['type']}) VERROUILLÉ -> le déverrouiller")
    for dm in (x for x in demandes if x["client_id"] == cid):
        print(f"     - demande {dm['type']} statut={dm['statut']} du {dm['date_demande']}"
              + (" -> à valider par le caissier désigné" if dm["statut"] == "en_attente" else "")
              + (f" (motif refus : {dm['motif_refus']})" if dm["statut"] == "refusee" else ""))
    tel = (c["telephone"] or "").replace(" ", "")
    homonymes = [
        o for o in clients.values()
        if o["id"] != cid and (cle(o) == cle(c) or (tel and (o["telephone"] or "").replace(" ", "") == tel))
    ]
    for o in homonymes:
        leurs = [x["numero"] for x in comptes if x["client_id"] == o["id"]]
        print(f"     - DOUBLON : autre fiche '{nom(o)}' id={o['id']} tél={o['telephone']}"
              f" n° tontine={o['code_client']} n° banque={o['code_client_banque']}"
              f" comptes={leurs or 'aucun'}")
    if not ses_comptes and not any(x["client_id"] == cid for x in demandes) and not homonymes:
        print("     - aucun compte ni demande : ouvrir un compte pour CE client puis le faire valider")
    print()
