# DON DE DIEU — guide pour les agents

Application de microfinance : tontine (carnets, cycles de 31 mises), comptes bancaires, caisse
d'agence, collecte par zone. Code, commentaires et messages en **français**.

## Architecture
- `backend/app` (FastAPI + SQLite) :
  - `engine.py` : toutes les actions (`ACTIONS`). `run_mutation` lit **tout** l'état (`repository.load_state`),
    applique l'action sur ce dictionnaire, puis **réécrit toute la base** (`_persist` -> `replace_state`)
    et renvoie tout l'état au front.
  - `metier.py` : règles de calcul (caisse, cycles…), dupliquées côté front dans `src/metier.ts`.
  - `repository.py` : conversion état camelCase <-> tables ; `migrations.py` : migrations au démarrage.
- `src/` (React + Vite) : `store.tsx` appelle `POST /api/mutations/{action}` et remplace ses données.

## Commandes
- Tests backend : `cd backend && pip install -r requirements-dev.txt && pytest -q` (CI : `.github/workflows`).
- Base de volume (≈ 10 000 clients synthétiques) : `python scripts/generer_volume.py --base /tmp/volume.db`
- Mesures : `python scripts/mesurer_performances.py --base /tmp/volume.db --json mesures.json`
- Front : `npm ci && npm run build`.

## Règles
- **Jamais de vraie base** : `backend/data/app.db` (données personnelles de clients) n'est pas dans le dépôt
  et ne doit jamais y entrer. Tests et mesures utilisent la démo et `generer_volume.py`.
- **Ne pas changer les règles métier** sauf si la tâche le demande : tous les tests doivent rester verts, et
  `tests/test_equivalence.py` doit rester identique à la ligne près.
- Rester dans le périmètre de fichiers de la tâche ; imiter le style existant (nommage, densité de commentaires).
- Une tâche = une branche `agent/<tache>` = une pull request vers `dev`, avec les mesures avant/après.

## Règles métier à ne pas casser
- **Une mise par cycle.** Un changement de mise ne vaut que pour le cycle en cours et les suivants ; un cycle
  terminé ou clôturé garde sa mise (`carnet.historiqueMises`, colonne JSON `historique_mises_json`).
  - Valoriser des carreaux d'un cycle : `M.mise_du_cycle(carnet, cycle)` (API) / `miseDuCycle` (front).
    Jamais `carnet["mise"] × carreaux` pour un cycle qui n'est pas le cycle en cours : `carnet["mise"]` n'est
    que la mise du cycle en cours et des dépôts à venir.
  - Baisse de mise (`changerMiseCarnet`, transaction `reduction_mise`, sans caisse) : l'argent du cycle en cours
    est reconverti en carreaux de la nouvelle mise (lignes de mise à `montant` 0 liées par `transactionId`,
    listées dans `historiqueMises[].lignes`) ; les lignes antérieures sont dans `historiqueMises[].misesAvant`.
  - Toute nouvelle façon d'écrire en base (ex. écriture différentielle) doit conserver `historique_mises_json`,
    comme `cycles_clotures_json` ; `tests/test_mise.py` et le scénario de référence couvrent ces cas.
- **Lignes de journal sans argent** : `cloture_cycle` (clôture sans retrait) et `reduction_mise`
  (`estLigneSansArgent` côté front) : ni caisse, ni entrée, ni sortie dans les totaux.

## Tests (`backend/tests`)
- Chaque test reçoit une copie neuve de la base de démo ; date du jour, heure et identifiants figés
  (`outils.Horloge`, « aujourd'hui » = `JOUR_TEST`). Fixtures : `banc` (base seule), `collecte` (caisse du
  jour ouverte + montant réel des zones saisi).
- `test_equivalence.py` : un scénario complet joué deux fois doit donner la même base ; ajouter un mode
  d'écriture dans `MODES_PERSISTANCE` / `persistance()` (`tests/outils.py`) le compare à la réécriture complète.
- `test_concurrence.py` : échec attendu (`xfail strict`) tant que les actions simultanées ne sont pas sérialisées.
