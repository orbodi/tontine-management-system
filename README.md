# MicroFinance Pro — Système de gestion de microfinance

Application web moderne de gestion de microfinance : clients, tontine individuelle (carnets),
épargne, crédits, journal des transactions et rapports. Interface entièrement en français,
devise FCFA.

## Fonctionnalités

- **Connexion et rôles** : Administrateur, Chef d'agence, Caissier (droits différenciés)
- **Tableau de bord** : indicateurs clés, alertes (retards, demandes à traiter), graphiques
- **Clients** : fiche complète avec ID client unique (CL-0001…), vue 360° de l'activité financière
- **Tontine individuelle** : carnets à mise fixe, encaissement des mises, clôture de cycle
  avec commission d'une mise
- **Épargne** : comptes (EP-0001…), dépôts, retraits avec contrôle de solde
- **Crédits** : demande → approbation (chef d'agence) → remboursements, détection des retards
- **Transactions** : journal complet filtrable (type, période, recherche), export Excel
- **Rapports** : état de caisse journalier, portefeuille de crédits, exports Excel, impression PDF
- **Notifications clients** : messages pré-remplis envoyés via SMS ou WhatsApp, ou copiés

## Comptes de démonstration

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `admin123` |
| Chef d'agence | `chef` | `chef123` |
| Caissier | `caisse` | `caisse123` |

## Démarrage

```bash
npm install
npm run dev
```

Puis ouvrez http://localhost:5173

## Build de production

```bash
npm run build
npm run preview
```

## Notes techniques

- **Stack** : React 18, TypeScript, Vite, Tailwind CSS, Recharts, React Router
- **Stockage** : les données sont conservées dans le navigateur (localStorage).
  Un jeu de données de démonstration est chargé au premier lancement ; le bouton
  « Réinitialiser les données de démo » dans la barre latérale permet de repartir de zéro.
- Les données étant locales au navigateur, une future migration vers un serveur
  (multi-postes) est possible sans changer l'interface.
