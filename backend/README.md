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
| `ENVIRONNEMENT` | `dev` (défaut) ou `production` (voir [Production](#production)) |
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

En dev, le CORS autorise aussi les origines du réseau privé (192.168 / 10 / 172.16–31).

## Production

Configuration : copier `.env.production.example` vers `backend/.env` et remplacer les valeurs d’exemple.
`ENVIRONNEMENT=production` (en dev, rien ne change) :

- **refus de démarrer**, avec un message listant chaque problème, si `SECRET_KEY` vaut la clé de dev ou fait
  moins de 32 caractères, si `SEED_DEMO_ON_STARTUP` ou `CREATE_DEFAULT_ACCOUNTS` vaut `true`, ou si
  `ADMIN_PASSWORD` / `CHEF_PASSWORD` / `CAISSE_PASSWORD` vaut `admin123` / `chef123` / `caisse123` ;
- **CORS** : seulement les origines de `CORS_ORIGINS` (pas le réseau local) ;
- `POST /api/admin/reinitialiser-demo` **désactivée** (403).

Clé JWT : `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

Dans tous les modes, `POST /api/mutations/reinitialiserDemo` est refusé (403) : seule la route admin
dédiée peut réinitialiser la démo, et la connexion est bloquée (429) après **5 échecs** pour un même
identifiant et une même adresse IP pendant **15 minutes** (remise à zéro après une connexion réussie).

Lancement :

```bash
# un seul processus : compteur de tentatives en mémoire et base SQLite réécrite à chaque action
uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

- Derrière un serveur web (HTTPS, front `dist/` et `/api` sur la même adresse) : `--proxy-headers` et
  `--forwarded-allow-ips` (adresse du serveur web) donnent la vraie adresse IP du client ; sans eux, tous les
  employés partagent l’adresse du serveur web pour la limite de connexion.
- Pas de `--reload`, pas de `--workers` > 1 (chaque processus aurait son propre compteur).

Comptes : en production, aucun compte n’est créé au démarrage.

- **Base existante** (`data/app.db`) : avant de passer en production, changer dans l’application les mots de
  passe des comptes créés avec les valeurs par défaut — le contrôle au démarrage porte sur la configuration,
  pas sur la base.
- **Première installation** (base vide) : démarrer une fois en `ENVIRONNEMENT=dev` avec
  `SEED_DEMO_ON_STARTUP=false`, `CREATE_DEFAULT_ACCOUNTS=true` et des mots de passe forts (écoute sur
  `127.0.0.1` seulement), arrêter, puis passer en production (`CREATE_DEFAULT_ACCOUNTS=false`).

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

## Tests et mesures

```bash
pip install -r requirements-dev.txt
pytest -q
```

Les tests (`tests/`) travaillent sur une copie de la base de démo, date et identifiants figés ; ils ne touchent jamais `data/app.db`. Pour mesurer les performances sur un volume réaliste sans données réelles :

```bash
python scripts/generer_volume.py --base /tmp/volume.db
python scripts/mesurer_performances.py --base /tmp/volume.db
```

## Comptes par défaut (valeurs `.env`)

| Rôle | Identifiant | Mot de passe |
|------|-------------|--------------|
| Admin | admin | admin123 |
| Chef | chef | chef123 |
| Caissier | caisse | caisse123 |

## Endpoints principaux

- `POST /api/auth/login` — JWT (429 après 5 échecs en 15 minutes)
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/data` — AppData complète (sans mots de passe)
- `POST /api/mutations/{action}` — mutations métier (sauf `reinitialiserDemo` : 403)
- `POST /api/admin/reinitialiser-demo` — admin only, désactivée en production
