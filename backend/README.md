# Backend API — DON DE DIEU

FastAPI + SQLite. Données dans `data/app.db`.

**Branche `prod`** : aucun chargement automatique des données de démo au démarrage (`seed_demo_on_startup=False`). Base vide jusqu’à import CSV ou création manuelle des comptes.

## Prérequis

Python **3.12** recommandé (`py -3.12`).

## Installation

```bash
cd backend
py -3.12 -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
```

## Démarrage

```bash
# depuis backend/
uvicorn app.main:app --reload --port 8000
```

API : http://127.0.0.1:8000/api/health  
Docs : http://127.0.0.1:8000/docs

## Comptes démo

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
