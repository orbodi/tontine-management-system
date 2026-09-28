# Déploiement en production — DON DE DIEU

Mise en ligne sur **un seul serveur Linux** (2 vCPU, 4 Go de RAM) avec Docker Compose.
Les fichiers sont dans `deploy/` ; ce guide les suit pas à pas.

> Statut : fichiers **préparés, pas encore déployés**. Voir « Avant la mise en production »
> pour ce qui dépend d'autres tâches.

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Avant la mise en production](#2-avant-la-mise-en-production)
3. [Prérequis du serveur](#3-prérequis-du-serveur)
4. [DNS](#4-dns)
5. [Pare-feu et SSH](#5-pare-feu-et-ssh)
6. [Stockage objet (sauvegardes)](#6-stockage-objet-sauvegardes)
7. [Code et configuration](#7-code-et-configuration)
8. [Premier démarrage : reprise de la base existante](#8-premier-démarrage--reprise-de-la-base-existante)
9. [Vérifications après démarrage](#9-vérifications-après-démarrage)
10. [Sauvegardes et test mensuel de restauration](#10-sauvegardes-et-test-mensuel-de-restauration)
11. [Mise à jour](#11-mise-à-jour)
12. [Retour arrière](#12-retour-arrière)
13. [Exploitation courante](#13-exploitation-courante)
14. [Limites connues](#14-limites-connues)

---

## 1. Vue d'ensemble

```
Internet ──80/443──▶ caddy ──/api/*──▶ api (uvicorn, 1 processus) ──▶ volume « base »
                      │                                                 /var/lib/tontine/app.db
                      └── front compilé (/srv)                                │
                                                          litestream ◀────────┘
                                                              │ réplication continue
                                                              ▼
                                                   stockage objet S3 (hors serveur)
```

| Service | Image | Rôle |
|---|---|---|
| `caddy` | `deploy/Dockerfile.front` (Node → Caddy 2.11) | HTTPS Let's Encrypt, front monopage, relais `/api/*`, compression, en-têtes de sécurité |
| `api` | `deploy/Dockerfile.api` (Python 3.12-slim) | FastAPI, **un seul processus**, utilisateur non-root (uid 10001), healthcheck `/api/health` |
| `litestream` | `litestream/litestream:0.5.17` | Réplication de la base vers S3, rétention 30 jours |
| `restauration` | `litestream/litestream:0.5.17` | Tâche ponctuelle avant l'API : restaure depuis S3 si le volume est vide, remet les droits du volume |

| Volume | Monté sur | Contenu |
|---|---|---|
| `tontine_base` | `/var/lib/tontine` (api, litestream) | `app.db` (+ `-wal`, `-shm`) : **les données des clients** |
| `tontine_sauvegardes-migration` | `/app/data/backups` (api) | Copies faites par l'application avant chaque migration de données ; copies manuelles avant mise à jour |
| `tontine_caddy-data`, `tontine_caddy-config` | `/data`, `/config` (caddy) | Certificats HTTPS |

Points importants :

- **Un seul processus uvicorn, jamais `--reload` ni `--workers` > 1** : chaque action lit toute la base
  puis la réécrit entièrement ; deux processus écraseraient mutuellement leurs écritures.
- **Aucun volume sur `/app/data`** : ce dossier contient des fichiers suivis nécessaires au démarrage
  (`demo-seed.json`, `plan-comptable-syscohada.json`, `sources/`). La base est ailleurs
  (`DATABASE_URL=sqlite:////var/lib/tontine/app.db`) ; seul `data/backups` a son volume.
  `/app/data` n'est pas inscriptible par l'application : si `DATABASE_URL` manquait, l'API échouerait
  au démarrage au lieu de créer une base hors volume.
- L'API n'a **aucun port publié** : seul Caddy la joint, sur le réseau interne Docker.
- Le front appelle `/api` en relatif (`VITE_API_URL` non défini) : même domaine, pas de CORS à ouvrir.

Dans tout ce guide, depuis n'importe quel dossier du serveur :

```bash
alias dc='docker compose -f /opt/tontine/deploy/docker-compose.yml'
```

(à ajouter dans `~/.bashrc` de l'utilisateur de déploiement).

## 2. Avant la mise en production

Dépendances vers d'autres tâches, à vérifier sur la version déployée :

| Point | Pourquoi | Vérification |
|---|---|---|
| `npm run build` passe | `Dockerfile.front` lance `npm run build` (`tsc -b && vite build`) ; aujourd'hui les erreurs TypeScript le font échouer | `npm ci && npm run build` en local. En attendant, `npx vite build` montre que la compilation Vite seule fonctionne. |
| Base SQLite en mode WAL | Litestream ne réplique qu'une base en mode WAL | Après démarrage : `app.db-wal` présent dans le volume, `PRAGMA journal_mode` = `wal` |
| Réglages de production lus par l'API | `docker-compose.yml` passe `ENVIRONNEMENT=production`, `SECRET_KEY`, `CORS_ORIGINS=https://<domaine>`, `SEED_DEMO_ON_STARTUP=false`, `CREATE_DEFAULT_ACCOUNTS=false` | `/api/health` : `seed_demo_on_startup` et `create_default_accounts` à `false` |

Décisions à prendre : nom de domaine, fournisseur de stockage objet, fuseau horaire (`TZ`), branche ou
étiquette git déployée, lieu de conservation du fichier `deploy/.env` (coffre de mots de passe).

## 3. Prérequis du serveur

- Ubuntu Server 24.04 LTS (ou Debian 12/13), 2 vCPU, 4 Go de RAM, disque SSD **local** de 40 Go ou plus
  (pas de NFS/SMB pour la base : les verrous SQLite y sont peu fiables).
- Adresse IPv4 fixe (IPv6 conseillée).
- Horloge synchronisée : `timedatectl` doit afficher `System clock synchronized: yes`.
- Mises à jour de sécurité automatiques : `sudo apt install unattended-upgrades`.
- 2 Go d'échange (la compilation du front consomme de la mémoire) :

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

- Docker Engine et le greffon Compose, depuis le dépôt officiel Docker
  (<https://docs.docker.com/engine/install/ubuntu/>) :

  ```bash
  sudo apt-get update && sudo apt-get install -y ca-certificates curl git
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
  ```

- Un utilisateur de déploiement (ex. `deploiement`) membre du groupe `docker`
  (`sudo usermod -aG docker deploiement`). Ce groupe équivaut à un accès root : le réserver aux
  administrateurs.

## 4. DNS

1. Choisir le nom (ex. `app.dondedieu.example`) et créer chez le registraire :
   - un enregistrement **A** vers l'IPv4 du serveur ;
   - un enregistrement **AAAA** vers l'IPv6, seulement si le serveur répond vraiment en IPv6
     (sinon Let's Encrypt peut échouer).
2. TTL court (300 s) pendant la mise en service.
3. Vérifier depuis un poste : `dig +short app.dondedieu.example` (ou `nslookup`) doit renvoyer l'IP
   du serveur **avant** le premier démarrage : Caddy demande le certificat dès le lancement.
4. Facultatif : enregistrement CAA `0 issue "letsencrypt.org"`.

## 5. Pare-feu et SSH

Ports ouverts : **80 et 443** pour tout le monde (443 en TCP et UDP pour HTTP/3), **22** pour SSH par
clé uniquement, si possible restreint aux adresses de l'administration. Rien d'autre.

### SSH par clé

Sur le poste d'administration :

```bash
ssh-keygen -t ed25519 -C "admin-tontine"
ssh-copy-id deploiement@IP_DU_SERVEUR
# Windows (PowerShell) :
# type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh deploiement@IP_DU_SERVEUR "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Vérifier la connexion par clé, **puis** sur le serveur (en gardant une session ouverte pendant le test) :

```bash
sudo tee /etc/ssh/sshd_config.d/10-durcissement.conf > /dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl reload ssh
```

### Pare-feu (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp            # ou : sudo ufw allow from <IP_ADMIN> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status verbose
```

Attention : les ports publiés par Docker contournent UFW. Seul `caddy` publie des ports (80/443) ;
**ne jamais ajouter de `ports:` au service `api`**. Appliquer les mêmes règles dans le pare-feu du
fournisseur cloud s'il en propose un (groupe de sécurité).

## 6. Stockage objet (sauvegardes)

Litestream envoie la base vers un seau compatible S3, **chez un autre fournisseur ou au moins dans
une autre région que le serveur**. Exemples : Scaleway Object Storage, OVHcloud Object Storage,
Backblaze B2, Cloudflare R2, AWS S3.

1. Créer un seau **privé** (ex. `tontine-sauvegardes`), sans accès public.
2. Créer des clés d'accès **limitées à ce seau** (lire, écrire, lister, supprimer).
3. Noter : nom du seau, point d'accès (URL S3 du fournisseur, vide pour AWS), région, clés.
4. Ne pas activer de règle de cycle de vie qui supprimerait des fichiers avant la rétention Litestream
   (30 jours par défaut) ; Litestream supprime lui-même ce qui dépasse la rétention.

## 7. Code et configuration

```bash
sudo mkdir -p /opt/tontine && sudo chown deploiement: /opt/tontine
git clone https://github.com/orbodi/tontine-management-system.git /opt/tontine
# dépôt privé : clé de déploiement GitHub en lecture seule (Settings > Deploy keys) et URL git@github.com:…
cd /opt/tontine
git checkout <étiquette ou commit à déployer>

cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
```

Remplir **toutes** les valeurs de `deploy/.env` :

| Variable | Valeur |
|---|---|
| `DOMAINE` | le nom configuré au §4 (sans `https://`) |
| `ACME_EMAIL` | adresse de contact pour Let's Encrypt |
| `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `TZ` | fuseau du lieu d'activité (fixe la date « du jour » de la caisse) : `Africa/Abidjan`, `Africa/Lome`, `Africa/Dakar`… (UTC+0), `Africa/Porto-Novo`, `Africa/Douala`… (UTC+1) |
| `VERSION` | `git rev-parse --short HEAD` (étiquette des images) |
| `LITESTREAM_*` | valeurs du §6 ; `LITESTREAM_PATH` : un chemin **neuf** (ex. `tontine/app.db`) |

Garder une copie de `deploy/.env` dans un coffre de mots de passe : sans elle, pas d'accès aux
sauvegardes si le serveur est perdu. Ce fichier n'est jamais versionné (`.gitignore`).

Contrôle de la configuration (affiche la configuration résolue, **contient les secrets**) :

```bash
dc config --quiet && echo "configuration OK"
```

## 8. Premier démarrage : reprise de la base existante

La production démarre de la base actuelle (installation Windows lancée par `lancer.bat`), nettoyée
des clients de test. Avec `SEED_DEMO_ON_STARTUP=false` et `CREATE_DEFAULT_ACCOUNTS=false`, une base
vide n'aurait **aucun utilisateur** : il faut donc charger la base avant de démarrer l'API.

### 8.1 Préparer la base sur l'installation actuelle

1. **Copie de sécurité** de `backend\data\app.db` avant toute manipulation (API arrêtée).
2. **Nettoyer les clients de test** dans l'application, avec le compte administrateur, jamais par SQL
   direct : supprimer d'abord les carnets de test, ramener à zéro puis supprimer les comptes de test,
   enfin supprimer les clients (l'application refuse de supprimer un client qui a encore carnets,
   comptes, crédits ou demandes en attente). Faire valider par le chef d'agence l'effet sur les caisses
   des opérations de test. Consigner la liste des clients supprimés.
3. **Aligner la version** : mettre l'installation actuelle au **même commit** que celui déployé,
   démarrer l'API une fois (les migrations s'appliquent, copies dans `backend\data\backups`), noter la
   liste `migrations` de `http://127.0.0.1:8000/api/health`, puis arrêter l'API.
   Sans cet alignement, une migration peut s'appliquer sur le serveur et changer les chiffres de
   contrôle (exemple observé sur la base de démonstration : la migration `004_caisse_unique_agence`
   fait passer la somme des soldes de caisse de 1 933 200 à 2 108 200).
4. **Changer les mots de passe faibles ou par défaut** (`admin123`, `chef123`, `caisse123`…) :
   l'application sera exposée sur Internet.
5. **Arrêter l'API** (fermer la fenêtre « DON DE DIEU - API ») et ne plus rien saisir sur cette
   installation à partir de maintenant.

### 8.2 Chiffres de référence

Enregistrer ce script sous `verifier_base.py` (sur le poste Windows **et** dans le dossier personnel
du serveur). Il ouvre la base en lecture seule :

```python
"""Chiffres de contrôle d'une base DON DE DIEU (lecture seule). Usage : python verifier_base.py chemin/app.db"""
import sqlite3
import sys

base = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
for libelle, sql in [
    ("Intégrité", "PRAGMA integrity_check"),
    ("Clients", "SELECT COUNT(*) FROM clients"),
    ("Clients actifs", "SELECT COUNT(*) FROM clients WHERE actif"),
    ("Carnets", "SELECT COUNT(*) FROM carnets"),
    ("Mises (somme)", "SELECT ROUND(COALESCE(SUM(montant), 0), 2) FROM mises"),
    ("Comptes", "SELECT COUNT(*) FROM comptes"),
    ("Soldes des comptes", "SELECT ROUND(COALESCE(SUM(solde), 0), 2) FROM comptes"),
    ("Soldes des caisses", "SELECT ROUND(COALESCE(SUM(solde), 0), 2) FROM comptes_caisse"),
    ("Transactions", "SELECT COUNT(*) FROM transactions"),
    ("Employés", "SELECT COUNT(*) FROM employes"),
    ("Dernière transaction", "SELECT MAX(date) FROM transactions"),
]:
    print(f"{libelle:<22}: {base.execute(sql).fetchone()[0]}")
```

Sur le poste Windows, depuis la racine du projet, produire une **copie cohérente** (API de sauvegarde
SQLite, sûre même en mode WAL) puis ses chiffres et son empreinte :

```powershell
py -3.12 -c "import sqlite3; s=sqlite3.connect(r'backend\data\app.db'); d=sqlite3.connect('app-transfert.db'); s.backup(d); d.close(); s.close()"
py -3.12 verifier_base.py app-transfert.db
certutil -hashfile app-transfert.db SHA256
```

Conserver cette sortie (registre de mise en production). « Intégrité » doit valoir `ok`.

### 8.3 Transférer la base

Uniquement par SSH (données personnelles) :

```powershell
ssh deploiement@IP_DU_SERVEUR "mkdir -p ~/reprise"
scp app-transfert.db deploiement@IP_DU_SERVEUR:~/reprise/app.db
```

Sur le serveur : `sha256sum ~/reprise/app.db` doit donner la même empreinte que `certutil`.

### 8.4 Construire les images et charger la base dans le volume

```bash
cd /opt/tontine
dc build          # échoue tant que `npm run build` échoue (voir §2)

# Copie dans le volume « base » (refuse d'écraser une base existante), droits pour l'uid 10001.
dc run --rm --no-deps -v ~/reprise:/import:ro --entrypoint /bin/sh restauration -c \
  'test ! -e /var/lib/tontine/app.db && cp /import/app.db /var/lib/tontine/app.db && chown -R 10001:10001 /var/lib/tontine && ls -l /var/lib/tontine'

# Chiffres dans le volume, avant tout démarrage de l'API : identiques au §8.2.
dc run --rm --no-deps -T api python - /var/lib/tontine/app.db < ~/verifier_base.py
```

### 8.5 Démarrer

```bash
dc up -d
dc ps                       # api « healthy », caddy et litestream « running », restauration « exited (0) »
dc logs --tail 50 api       # migrations éventuelles, « Application startup complete »
dc logs --tail 50 caddy     # obtention du certificat (« certificate obtained successfully »)
dc logs --tail 50 litestream
```

### 8.6 Vérifier la reprise

```bash
dc exec -T api python - /var/lib/tontine/app.db < ~/verifier_base.py
curl -s https://$DOMAINE/api/health     # liste « migrations » identique à celle notée au §8.1
```

- Les chiffres doivent être **identiques** à ceux du §8.2 (nombre de clients, sommes des mises, des
  soldes des comptes et des caisses, nombre de transactions). En cas d'écart : ne pas ouvrir le
  service, comparer la liste des migrations, consulter `dc logs api`.
- Dans l'application : connexion avec un compte réel, nombre de clients, fiches et soldes de quelques
  clients choisis à l'avance, caisse du jour.
- Faire tout de suite un **test de restauration** (§10.3) : c'est la seule preuve que les sauvegardes
  fonctionnent.
- Supprimer les copies temporaires (`~/reprise`, `app-transfert.db` sur le poste Windows) ; archiver la
  base Windows finale chiffrée, selon la décision prise, puis désinstaller ou désactiver l'ancienne
  installation pour éviter toute double saisie.

## 9. Vérifications après démarrage

```bash
curl -sI http://$DOMAINE/ | head -3                     # 308 vers https://
curl -sI https://$DOMAINE/ | grep -iE 'strict-transport|x-content-type|x-frame|content-security|referrer'
curl -s https://$DOMAINE/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAINE/docs   # sert le front (200), pas la doc FastAPI
```

(`$DOMAINE` : exporter la valeur, ou la remplacer dans les commandes.)

Facultatif : <https://www.ssllabs.com/ssltest/> (note A attendue) et
<https://securityheaders.com>.

## 10. Sauvegardes et test mensuel de restauration

### 10.1 Ce qui est sauvegardé

| Quoi | Où | Fréquence / durée |
|---|---|---|
| Base complète, en continu | Seau S3 (Litestream) | toutes les 10 s (`LITESTREAM_SYNC_INTERVAL`), instantané quotidien, restauration à n'importe quel instant des **30 derniers jours** (`LITESTREAM_RETENTION=720h`) |
| Copie avant chaque migration de données | volume `tontine_sauvegardes-migration` | à chaque démarrage qui applique une migration ; jamais purgé automatiquement |
| Copie avant mise à jour | même volume | manuelle (§11) |
| `deploy/.env` | coffre de mots de passe | à chaque modification |

Perte maximale en cas de destruction du serveur : environ `LITESTREAM_SYNC_INTERVAL` (10 s).
Les copies du volume `sauvegardes-migration` sont **sur le serveur** : elles ne protègent pas d'une
perte du serveur.

### 10.2 Surveillance

- `dc logs --since 24h litestream | grep -iE 'error|erreur'` : doit être vide.
- Vérifier chaque semaine dans la console du fournisseur que des fichiers récents arrivent dans le
  seau (dossier `LITESTREAM_PATH`).
- Surveillance externe conseillée : un service de sonde (UptimeRobot, Healthchecks…) sur
  `https://<domaine>/api/health`.

### 10.3 Test mensuel de restauration

À faire **chaque mois** (et après chaque changement de configuration Litestream), de préférence
après l'arrêt de caisse, quand plus rien n'est saisi. Durée : quelques minutes.

```bash
# 1. Restaurer la dernière version depuis S3 dans un dossier de test (jamais dans le volume « base »).
sudo rm -rf ~/test-restauration && mkdir -p ~/test-restauration
dc run --rm --no-deps -v ~/test-restauration:/test --entrypoint /bin/sh restauration -c \
  'litestream restore -config /etc/litestream.yml -o /test/app.db /var/lib/tontine/app.db && chown -R 10001:10001 /test'

# 2. Chiffres de la base restaurée…
dc run --rm --no-deps -T -v ~/test-restauration:/test api python - /test/app.db < ~/verifier_base.py
# 3. …et de la base en service.
dc exec -T api python - /var/lib/tontine/app.db < ~/verifier_base.py

# 4. Effacer la copie (données personnelles).
sudo rm -rf ~/test-restauration
```

Résultat attendu : « Intégrité » à `ok` et chiffres **identiques** (ou, si des opérations ont été
saisies pendant le test, écart limité aux dernières secondes : comparer « Dernière transaction »).
Noter dans le registre : date, durée, chiffres, résultat. Un test en échec est un incident à traiter
immédiatement.

Restauration à un instant donné (heure **UTC**, format RFC 3339) : ajouter
`-timestamp 2026-09-01T18:00:00Z` à la commande `litestream restore`.

## 11. Mise à jour

À faire hors des heures d'activité (l'API redémarre : quelques secondes d'indisponibilité).

```bash
cd /opt/tontine

# 1. Noter la version en service (pour le retour arrière).
git log --oneline -1
grep ^VERSION deploy/.env

# 2. Copie cohérente de la base, dans le volume des copies (API de sauvegarde SQLite, API en marche).
dc exec -T api python -c "import sqlite3, datetime; s = sqlite3.connect('/var/lib/tontine/app.db'); d = sqlite3.connect('/app/data/backups/app-avant-maj-' + datetime.datetime.now().strftime('%Y%m%d-%H%M') + '.db'); s.backup(d); d.close(); s.close()"
dc exec api ls -l /app/data/backups

# 3. Nouvelle version.
git fetch origin
git checkout <nouvelle étiquette ou commit>
sed -i "s/^VERSION=.*/VERSION=$(git rev-parse --short HEAD)/" deploy/.env

# 4. Construire puis remplacer les conteneurs.
dc build
dc up -d

# 5. Vérifier.
dc ps
dc logs --tail 50 api
curl -s https://$DOMAINE/api/health
dc exec -T api python - /var/lib/tontine/app.db < ~/verifier_base.py
```

Les images précédentes restent présentes (étiquetées par `VERSION`) : elles servent au retour
arrière. Lire les notes de version : si elles annoncent une migration de données, l'application fait
aussi sa propre copie avant migration dans le même volume.

## 12. Retour arrière

### 12.1 Code seul (pas de migration de données entre les deux versions)

La liste `migrations` de `/api/health` n'a pas changé : revenir aux images précédentes suffit.

```bash
cd /opt/tontine
git checkout <ancien commit>
sed -i "s/^VERSION=.*/VERSION=<ancienne étiquette>/" deploy/.env
dc up -d                       # réutilise les anciennes images ; sinon `dc build` d'abord
```

### 12.2 Code et base (une migration a modifié les données)

Les opérations saisies depuis la copie choisie **seront perdues** : décision du responsable, et
ressaisie éventuelle à prévoir.

1. Arrêter l'API et Litestream, garder la base actuelle pour analyse, retirer la base en service :

   ```bash
   dc stop api litestream
   dc run --rm --no-deps --user root --entrypoint /bin/sh api -c \
     'set -e; d=/app/data/backups/incident-$(date +%Y%m%d-%H%M); mkdir -p $d; cp -a /var/lib/tontine/. $d/; cd /var/lib/tontine; rm -rf app.db app.db-wal app.db-shm .app.db-litestream; ls -la /app/data/backups'
   ```

   Supprimer `app.db-wal` et `app.db-shm` avec l'ancienne base est **indispensable** : un journal WAL
   appliqué à une autre base la corromprait.

2. Remettre une base, au choix :

   - la copie d'avant mise à jour (§11, étape 2) :

     ```bash
     dc run --rm --no-deps --user root --entrypoint /bin/sh api -c \
       'cp /app/data/backups/app-avant-maj-AAAAMMJJ-HHMM.db /var/lib/tontine/app.db && chown -R 10001:10001 /var/lib/tontine'
     ```

   - ou la réplique Litestream à un instant donné (UTC), par exemple juste avant la mise à jour :

     ```bash
     dc run --rm --no-deps --entrypoint /bin/sh restauration -c \
       'litestream restore -config /etc/litestream.yml -timestamp 2026-09-25T18:00:00Z /var/lib/tontine/app.db && chown -R 10001:10001 /var/lib/tontine'
     ```

3. **Nouveau chemin de réplique** : la base remise en place est plus ancienne que la réplique ; pour ne
   pas mélanger les deux historiques, Litestream repart sur un chemin neuf. L'ancien chemin reste
   disponible pour une restauration ; le supprimer à la main dans la console du fournisseur après la
   durée de rétention.

   ```bash
   sed -i "s#^LITESTREAM_PATH=.*#LITESTREAM_PATH=tontine/app-$(date +%Y%m%d).db#" deploy/.env
   ```

   Mettre à jour la copie de `deploy/.env` dans le coffre.

4. Revenir à l'ancien code (§12.1), puis `dc up -d`, puis les vérifications du §8.6 et un test de
   restauration (§10.3).

### 12.3 Serveur perdu

Nouveau serveur préparé (§3 à §5), même domaine (mettre à jour le DNS), même `deploy/.env` (copie du
coffre) :

```bash
git clone … /opt/tontine && cd /opt/tontine && git checkout <version en service>
# replacer deploy/.env (chmod 600)
dc up -d --build
```

Le service `restauration` trouve le volume vide et restaure automatiquement la dernière version depuis
S3 avant de démarrer l'API. Vérifier ensuite comme au §8.6.

## 13. Exploitation courante

| Besoin | Commande |
|---|---|
| État des services | `dc ps` |
| Journaux | `dc logs -f --tail 100 api` (ou `caddy`, `litestream`) |
| Redémarrer l'API | `dc restart api` |
| Arrêter / démarrer tout | `dc down` / `dc up -d` (**jamais** `dc down -v` : supprime les volumes, donc la base) |
| Espace disque | `df -h` ; `docker system df` |
| Anciennes images | `docker image ls tontine-api` puis `docker image rm tontine-api:<étiquette>` (garder les deux dernières) |

- Les conteneurs redémarrent seuls après un redémarrage du serveur (`restart: unless-stopped`).
- Les certificats HTTPS se renouvellent automatiquement (volume `tontine_caddy-data` à conserver).
- Les journaux Docker sont limités à 5 × 10 Mo par service.
- Tester la pile sur un poste avec Docker : `DOMAINE=localhost` dans `deploy/.env` (certificat de
  l'autorité interne de Caddy, avertissement du navigateur attendu).

## 14. Limites connues

- **Volume envoyé vers S3** : l'application réécrit toute la base à chaque action, donc chaque
  synchronisation Litestream envoie à peu près toute la base. Surveiller la taille du seau le premier
  mois ; ajuster `LITESTREAM_SYNC_INTERVAL` (plus long = moins d'envois, mais plus de perte possible)
  et `LITESTREAM_RETENTION`. Une écriture incrémentale côté application réduirait fortement ce volume.
- **À corriger avant la mise en production — étape 0 du chantier API <-> base** (branche
  `agent/etape-0-securisation`) : tant qu'elle n'est pas fusionnée,
  - les actions simultanées ne sont pas sérialisées (FastAPI exécute les routes synchrones dans
    plusieurs fils) : erreurs « database is locked » ou actions écrasées, voir
    `backend/tests/test_concurrence.py` ;
  - les copies avant migration (`migrations._backup_sqlite`) copient le seul fichier `app.db` : en mode
    WAL elles peuvent manquer les dernières transactions encore dans `app.db-wal`. La réplique
    Litestream et la copie manuelle du §11 (API de sauvegarde SQLite) n'ont pas ce défaut.
- **Base vide impossible à utiliser** : sans reprise ni restauration, `CREATE_DEFAULT_ACCOUNTS=false`
  laisse une base sans utilisateur (vérifié : 0 employé). Pour une installation neuve, voir la procédure
  de première installation de la section « Production » de `backend/README.md`.
