# Backend API — DON DE DIEU

FastAPI + SQLite. Données dans `data/app.db`. Configuration via `backend/.env` (voir `.env.example`).

Sur la branche **`dev`**, `SEED_DEMO_ON_STARTUP=true` par défaut (charge `demo-seed.json` si la base est vide).

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
# depuis backend/
uvicorn app.main:app --reload --port 8000
```

API : http://127.0.0.1:8000/api/health  
Docs : http://127.0.0.1:8000/docs

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
