# DON DE DIEU — Système de gestion de microfinance

Application web de gestion pour la microfinance **DON DE DIEU** : clients, tontine individuelle (carnets),
épargne, journal des transactions et rapports. Interface entièrement en français, devise FCFA.

**Stack** : React 18 + Vite (front) · FastAPI + SQLite (API).

## Fonctionnalités

- **Connexion et rôles** : Administrateur, Chef d'agence, Caissier (droits différenciés)
- **Tableau de bord** : indicateurs clés, manquant/surplus de caisse
- **Clients** : fiche complète, vue 360° (filtrée pour le caissier = ses opérations)
- **Tontine** : carnets, collecte zone (montant réel), dépôts, retraits
- **Comptes** : courant / épargne, dépôts et retraits
- **Caisse** : ouverture / arrêt journalier, compte caisse, cumuls
- **Transactions & rapports** : journal filtrable, exports

## Comptes de démonstration

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `admin123` |
| Chef d'agence | `chef` | `chef123` |
| Caissier | `caisse` | `caisse123` |

## Démarrage (dev)

### Windows (recommandé)

Double-cliquez sur `lancer.bat` : il prépare au besoin les dépendances, ouvre l’API FastAPI, puis le front Vite (navigateur).

### Manuel

**1. API (terminal 1)**

```bash
cd backend
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Voir aussi [backend/README.md](backend/README.md).

**2. Front (terminal 2)**

```bash
npm install
npm run dev
```

Ouvrir http://localhost:5173 — le proxy Vite redirige `/api` vers `http://127.0.0.1:8000`.

## Build front

```bash
npm run build
npm run preview
```

## Notes techniques

- **Persistance** : SQLite (`backend/data/app.db`), seed automatique au premier démarrage
- **Auth** : JWT Bearer, mots de passe hashés (bcrypt)
- **Branche** : développement API sur `dev`
- Le bouton « Réinitialiser les données de démo » (admin) appelle `POST /api/admin/reinitialiser-demo`
