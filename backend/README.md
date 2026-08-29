# Backend API — DON DE DIEU

FastAPI + SQLite. Données dans `data/app.db`. Configuration via `backend/.env` (voir `.env.example`).

Sur la branche **`dev`**, `SEED_DEMO_ON_STARTUP=true` par défaut (charge `demo-seed.json` si la base est vide).

Plan comptable : `data/plan-comptable-syscohada.json` (liste SYSCOHADA révisée d’après [LeFisk](https://lefisk.cm/blog/plan-comptable-syscohada-revise-liste-comptes), + comptes analytiques microfinance). Régénération : `python scripts/generate_plan_syscohada.py`.

## Prérequis

Python **3.12** recommandé (`py -3.12`).

## Installation

```bash
cd backend
py -3.12 -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Variables utiles dans `.env` :

| Variable | Rôle |
|----------|------|
| `SEED_DEMO_ON_STARTUP` | `true` = charge `demo-seed.json` si base vide |
| `CREATE_DEFAULT_ACCOUNTS` | `true` = crée admin/chef/caisse si base vide |
| `ADMIN_*` / `CHEF_*` / `CAISSE_*` | Identifiants et mots de passe par défaut |
| `SECRET_KEY` | Clé JWT (à changer en production) |

## Démarrage

```bash
# depuis backend/ — écoute localhost + réseau local
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API locale : http://127.0.0.1:8000/api/health  
API réseau : http://<IP-LAN>:8000/api/health  
Docs : http://127.0.0.1:8000/docs

Le CORS autorise aussi les origines du réseau privé (192.168 / 10 / 172.16–31).

## Migrations (schéma + données)

Pas d’Alembic : le fichier SQLite est petit, et `replace_state` réécrit l’AppData. Les évolutions passent par un registre Python dans `app/migrations.py`, journalisé en table `schema_migrations` (hors AppData, donc conservé après réinit démo / import CSV).

Ordre au démarrage :

1. `create_all` — crée les tables neuves
2. migrations **schéma** encore absentes (`001_…`, `002_…`)
3. seed si la base est vide
4. migrations **données** encore absentes (`003_…`) — copie de `app.db` dans `data/backups/` juste avant

Chaque id s’applique **une fois**. Les fonctions restent idempotentes. Après import d’une ancienne sauvegarde CSV, le réalignement des numéros est relancé sans réécrire le journal.

| Id | Type | Effet |
|----|------|--------|
| `001_comptes_frais_ouverture` | schéma | colonnes part sociale / adhésion |
| `002_carnets_unicite_numero_type` | schéma | unicité `(numero, type_carnet)` |
| `003_numeros_clients_zzxxxx` | données | N° client/carnet `ZZxxxx` |
| `004_caisse_unique_agence` | données | Une caisse par agence |
| `005_realigner_numeros_zzxxxx` | données | Réapplique `ZZxxxx` si l’ancien format 4 chiffres est encore là |
| `006_clients_numero_banque` | schéma | Colonnes n° client banque |
| `007_attribuer_numeros_clients_banque` | données | N° banque `0001`, `0002`… au premier compte |

`GET /api/health` liste les ids déjà appliqués (`migrations`). Pour ajouter une évolution : une entrée dans `MIGRATIONS` (jamais modifier un id déjà livré). Les copies `data/backups/app-avant-*.db` ne sont pas purgées automatiquement.

## Comptes par défaut (valeurs `.env`)

| Rôle | Identifiant | Mot de passe |
|------|-------------|--------------|
| Admin | admin | admin123 |
| Chef | chef | chef123 |
| Caissier | caisse | caisse123 |

## Endpoints principaux

- `POST /api/auth/login` — JWT
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/data` — AppData complète (sans mots de passe)
- `POST /api/mutations/{action}` — mutations métier
- `POST /api/admin/reinitialiser-demo` — admin only
