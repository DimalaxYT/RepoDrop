# RepoDrop

> **Vos archives de code, sur GitHub, en un glisser-déposer.**
> Un `.rar`, un `.zip` ou un `.tar` → un dépôt GitHub. Sans terminal, sans clone, sans configuration git.

RepoDrop est un outil web (interface 100 % française) qui :

1. se connecte à **votre** GitHub (OAuth, scopes `repo` + `workflow`) ;
2. reçoit votre **archive `.rar` / `.zip` / `.tar[.gz]`** ;
3. l'extrait dans un **espace sandboxé** (chemins vérifiés, anti-bombes) ;
4. vous montre un **aperçu complet** avant tout envoi ;
5. **pushe** le contenu dans un dépôt neuf ou existant, avec votre identité GitHub ;
6. tient un **journal d'activité** (qui a poussé quoi, et quand) et un **bot Discord**
   qui ping le site toutes les 10 minutes — le tout pilotable depuis un **panel staff**.

---

## Démarrage rapide

### 1. Créer l'application OAuth GitHub

Allez sur [github.com/settings/developers → New OAuth App](https://github.com/settings/developers) :

| Champ | Valeur |
|---|---|
| Application name | `RepoDrop` (ou ce que vous voulez) |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `http://localhost:3000/api/auth/callback` |

Copiez le *Client ID* et générez un *Client secret*.

### 2. Configurer l'environnement

```bash
cp .env.example .env
# éditez .env :
#   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
#   SESSION_SECRET   → openssl rand -hex 32
#   STAFF_LOGINS     → votre login GitHub (panel staff)
```

Variables importantes :

| Variable | Rôle | Défaut |
|---|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App GitHub. **Important :** déclarer les scopes `repo` et `workflow` dans l'OAuth App (sans `workflow`, GitHub rejette les push qui touchent à `/.github/workflows/`). | — |
| `APP_URL` | URL publique (callback OAuth + sonde de disponibilité) | `http://localhost:3000` |
| `SESSION_SECRET` | Chiffrement du cookie de session **et du jeton Discord** | — |
| `DEV_AUTH=1` | Bouton « connexion directe » via `GH_TOKEN` du serveur (**dev uniquement**) | off |
| `STAFF_LOGINS` | Logins GitHub autorisés sur `/staff` (séparés par des virgules) | — |
| `DISCORD_BOT_TOKEN` / `DISCORD_WEBHOOK_URL` | Amorçage du bot (aussi configurable depuis le panel) | — |
| `DISCORD_CHANNEL_ID` | Canal cible du bot | — |
| `DISCORD_PING_MINUTES` | Période du ping de disponibilité | `10` |
| `MAX_UPLOAD_MB` | Poids max d'une archive | `200` |
| `MAX_EXTRACT_MB` | Poids max décompressé (anti-bombe) | `500` |
| `MAX_FILES` | Nombre max de fichiers | `20000` |

### 3. Lancer

```bash
npm install
npm run dev          # http://localhost:3000
```

ou en production :

```bash
cp .env.example .env   # remplir les valeurs
docker compose up -d --build
```

### 4. Derrière un proxy (preview, ingress, tunnel)

L'app est prévue pour tourner derrière un proxy qui termine le TLS :

- les **redirections** sont *relatives* (`Location: /import`) : le navigateur les
  résout sur l'origine courante — jamais sur l'adresse interne du serveur
  (`0.0.0.0`, qui n'est pas navigable) ;
- le cookie de session est marqué `Secure` seulement si la requête arrive
  vraiment en HTTPS (`x-forwarded-proto`, ou `APP_URL` si l'hôte correspond) ;
- `APP_URL` doit pointer sur l'URL publique **et** correspondre à l'URL de
  callback déclarée dans l'OAuth App GitHub.

En développement, `next.config.ts` autorise les origines de preview via
`allowedDevOrigins` (sinon Next bloque les ressources `/_next/*`).

```bash
# écouter sur toutes les interfaces (obligatoire derrière un proxy)
npx next dev -H 0.0.0.0 -p 10000
```

---

## Utilisation

1. **Connexion** avec GitHub (scopes `repo` et `workflow`). L'écran de connexion liste ces scopes et leur raison.
2. **Importer** → glisser-déposer du `.rar`, `.zip`, `.tar` ou `.tar.gz`.
3. **Aperçu** : fichiers, poids, dossier racine, `node_modules`, filtres.
4. **Destination** :
   - **Nouveau dépôt** : nom + privé/public ;
   - **Dépôt existant** : choisissez parmi vos dépôts (droits d'écriture vérifiés côté API) ;
   - option **branche dédiée** pour ne jamais toucher à la branche par défaut.
5. **Pousser** → commit créé sous `votre-login <votre-login@users.noreply.github.com>`, suivi en direct, lien vers le dépôt.
6. **Liens IA** : après le push, RepoDrop affiche une série de liens prêts à donner à un agent IA / humain :
   - URL GitHub classique, branche, commit et **Codespaces** (`vscode.dev` + Copilot intégrés) ;
   - URL **`vscode.dev`** (éditeur web officiel) ;
   - URL de clone HTTPS (l'agent s'authentifie lui-même via sa session GitHub) ;
   - commande **`gh repo clone`** prête à copier ;
   - téléchargement du code en **`.zip`** (`GET /api/jobs/[id]/download`, node_modules exclus).

### Formats d'archives

| Format | Lecteur | Notes |
|---|---|---|
| `.zip` | `yauzl` (streaming) | deflate/stored ; archives chiffrées refusées |
| `.rar` | `node-unrar-js` en WASM, **processus enfant isolé** | RAR4 & RAR5 ; volumes multi-parties non supportés |
| `.tar` | lecteur **ustar/GNU/PAX maison**, zéro dépendance | noms longs GNU (`L`) et PAX (`x`), préfixes ustar |
| `.tar.gz` / `.tgz` | idem + `zlib` en streaming | décompression à la volée, jamais en mémoire |

Détection par **magic bytes** (pas par l'extension) : `ustar` est lu à l'octet 257,
et pour un `.tar.gz` le début du flux est décompressé en mémoire tampon avant
décision. Les dossiers `.tar` sont donc acceptés au même titre que les archives.

---

## Mes dépôts (`/repos`)

Parcourir avant d'importer : la page liste les dépôts visibles par votre jeton
(propriétaire + collaborateur, 300 au plus, les plus récents d'abord), avec
filtre, tri et un mode « les miens ».

| Ce qu'on peut faire | Comment |
|---|---|
| Voir le contenu d'un dépôt | clic sur un dépôt → arborescence, dossier par dossier |
| Lire un fichier | clic sur le fichier : texte décodé, n° de lignes, langage, copie |
| Changer de branche | sélecteur en haut du dépôt |
| Renommer | onglet **Actions** → « Renommer / décrire » |
| Passer public/privé | onglet **Actions** → visibilité |
| Supprimer | onglet **Actions** → il faut retaper `owner/repo` |

Garde-fous :

- **chemins validés** : `..`, chemins absolus et octets nuls sont refusés avant
  même d'appeler GitHub ;
- **aperçu borné** : au-delà de 512 Ko, rien n'est transféré (lien vers GitHub) ;
  un contenu non décodable en UTF-8 est signalé binaire, jamais deviné ;
- **jamais d'HTML interprété** : le contenu s'affiche en texte dans un `<pre>`,
  donc un `README.md` ou un SVG hostile ne peut rien exécuter ;
- **droits vérifiés** : les boutons sont désactivés sans `push`/`admin` ;
- **traçabilité** : renommage, changement de visibilité et suppression sont
  journalisés dans le flux d'activité du panel staff (qui, quoi, quand, IP).

> La suppression exige le scope OAuth **`delete_repo`**, désormais demandé à la
> connexion. Un compte déjà connecté doit se **reconnecter** pour l'obtenir ;
> sans lui GitHub répond 404 et l'application l'explique explicitement.

---

## Panel staff (`/staff`)

Aucun bouton visible n'y mène : c'est un outil staff. Trois portes discrètes,
toutes équivalentes :

1. **le logo RepoDrop du pied de page** (le carré vert, à gauche du nom) ;
2. le **point quasi invisible** en bas à droite du pied de page (5 clics) ;
3. la séquence **Konami** `↑ ↑ ↓ ↓ ← → ← → B A`.

### Deux verrous cumulatifs

La porte n'est qu'un raccourci : **tout se décide côté serveur**, dans
`checkStaff()`, par où passent la page *et* toutes les API `/api/staff/*`.

| Verrou | Réglage | Effet s'il manque |
|---|---|---|
| 1. Allowlist | `STAFF_LOGINS=login1,login2` | écran « accès restreint », API en 403 |
| 2. Mot de passe | onglet **Sécurité** du panel, ou `STAFF_PASSWORD` | écran de saisie, API en 403 `locked` |

Le mot de passe est **haché en scrypt** (sel aléatoire, `N=16384`) avant
d'être écrit en base : il n'est jamais renvoyé par l'API, jamais journalisé, et
personne ne peut le relire — pas même depuis le panel. Sa validation est portée
par le **cookie de session chiffré** (`staffUnlocked`), donc :

- elle ne vaut que pour la session en cours (7 jours max), jamais partagée ;
- la déconnexion, ou le bouton « Verrouiller maintenant », la supprime ;
- changer le mot de passe ne vous éjecte pas de votre propre session.

Après **6 échecs**, l'IP est suspendue 15 minutes (`429`), même avec le bon mot
de passe. Une simple faute de frappe ne bloque rien : le seuil n'est atteint
qu'au sixième échec consécutif.

Sans mot de passe défini, l'allowlist suffit (comportement d'origine).

Quatre onglets :

### 1. Activité

Le journal répond à « **qui a poussé du code, et à quelle heure ?** » :

| Colonne | Contenu |
|---|---|
| Horodatage | heure exacte + relatif (« il y a 4 min »), date complète au survol |
| Utilisateur | avatar GitHub + login |
| Événement | `push` (réussi/échec), `upload`, `login`, `settings`, `discord` |
| Détails | dépôt, branche, SHA (liens GitHub), nb de fichiers, volume, nom de l'archive, IP |

Filtres (type, utilisateur, recherche libre), rafraîchissement automatique
15 s, pagination et **export CSV**.

### 2. Discord

Le **jeton Discord se configure ici** :

- jeton de **bot** (Portail développeurs → Bot → Reset Token) **ou** URL de **webhook** ;
- identifiant du **canal** ;
- **période du ping** (défaut 10 min, bornée de 1 à 1440) ;
- options : ping périodique, annonce des push, alerte si le site ne répond plus,
  mention en cas de panne, URL sondée ;
- boutons : **Tester le jeton**, **Message de test**, **Ping maintenant**,
  **Démarrer/Arrêter**.

Le jeton est **write-only** : chiffré en AES-256-GCM (clé dérivée de
`SESSION_SECRET`) avant d'aller en base, jamais renvoyé au navigateur — l'API ne
retourne qu'un masque (`MTok…••••1a2b`) et un booléen « configuré ».

### 3. Système

Historique de disponibilité (chaque sonde du bot, 7 jours), latence moyenne,
et l'état de la configuration (limites, `SESSION_SECRET`, comptes staff,
`DEV_AUTH`).

### Le bot Discord

`lib/discord/` contient un client Discord **sans dépendance externe** :

- **REST** pour envoyer les messages (`POST /channels/:id/messages`, ou le
  webhook) ;
- **Gateway** (`wss://gateway.discord.gg`, opcodes HELLO/IDENTIFY/HEARTBEAT/
  READY) pour que le bot apparaisse **en ligne** et pour mesurer sa latence ;
  reconnexion en backoff, arrêt net si le jeton est refusé (4004).

Toutes les 10 minutes (configurable) :

1. `GET <APP_URL>/api/health` → latence et code HTTP mesurés ;
2. la sonde est enregistrée en base (historique de disponibilité) ;
3. un **embed** est publié sur Discord : réponse, latence, disponibilité 24 h,
   nombre de push, URL sondée. En cas de panne, le message passe au rouge et
   porte la mention configurée (`@here`, un rôle…) ; au retour, un message
   « de retour » est envoyé.

Chaque push (réussi ou échoué) peut aussi être annoncé : utilisateur, dépôt,
branche, commit, volume, horodatage.

---

## Sécurité & limites

| Risque | Protection |
|---|---|
| Zip-slip / path traversal (`../`, `C:\`, absolu) | Sanitisation systématique (`lib/sanitize.mjs`), **refus intégral** de l'archive en cas d'attaque |
| Bombes de décompression | Cumul des tailles déclarées **avant** écriture + compteur réel, `MAX_EXTRACT_MB` / `MAX_FILES` |
| Symlinks (zip, rar, tar) | Écartés (zip/tar) ou matérialisés en fichiers réguliers vides (rar) — aucun lien créé |
| Hardlinks `.tar` | Écartés et comptés séparément |
| Motif « fichier + ancêtre » (`up` puis `up/x`) | Contrôle structurel → archive refusée |
| `.tar` corrompu / tronqué | Somme de contrôle de chaque en-tête + taille écrite vérifiée |
| `.git/` embarqué | Toujours ignoré (`.gitignore`, `.gitattributes` conservés) |
| Token GitHub | **Jamais en base, jamais en log** : cookie chiffré httpOnly (JWE A256GCM) ; push via `GIT_ASKPASS` (env), jamais dans les arguments de process |
| Token Discord | Chiffré en base (AES-256-GCM), **jamais renvoyé** par l'API, absent des logs et du journal |
| Panel staff | Allowlist `STAFF_LOGINS`, vérifiée côté serveur sur la page **et** sur chaque API (401/403) |
| Rate-limit | 30 uploads/h par IP, 10 poussées/h par utilisateur (persistant en base) |
| Fichiers > 100 Mo | Avertissement dans l'aperçu (limite GitHub) |

Limite de taille par défaut : **200 Mo** uploadés, **500 Mo** décompressés, **20 000** fichiers.

---

## Tests

```bash
npm test
```

188 tests couvrent :

- sanitisation (traversal Unix/Windows, absolus, NUL, profondeur) ;
- extraction `.zip` réelle (fixtures `yazl` : nominal, bombes, symlinks, `.git`, limites) ;
- extraction `.rar` réelle via le **worker enfant** (fixtures RAR4/RAR5, unicode, mot de passe, volumes, symlink traversal) ;
- extraction `.tar` / `.tar.gz` **réelles** (archives produites par GNU tar : ustar, GNU longname, PAX, symlinks, hardlinks, bit exécutable) et **hostiles** (traversal, absolu, bombe, somme de contrôle fausse, troncature, conflit fichier/ancêtre) ;
- détection de format (magic bytes zip/rar/tar, `.tar.gz` décompressé, `.tgz` trop court) ;
- flux git complet (`init → fetch → overlay → commit → push`) contre un **dépôt bare local** ;
- bot Discord : construction des embeds, routage webhook/bot, poignée de main Gateway (faux WebSocket), cycle du moniteur (sonde, ping forcé, push, panne) ;
- réglages chiffrés (aucun secret en clair dans SQLite), journal d'activité, sondes de disponibilité ;
- contrôle d'accès staff (`STAFF_LOGINS`, mode dev) ;
- chiffrement de session et reconstruction de l'URL publique derrière un proxy.

CI : GitHub Actions (lint + typecheck + tests + build) sur chaque push/PR.

---

## Architecture

```
app/                  # Next.js App Router — pages FR + routes API
  api/auth/*          # OAuth GitHub (login, callback, logout, dev-login)
  api/upload          # réception multipart (busboy, streaming vers /tmp)
  api/jobs/[id]       # statut du job + lancement du push
  api/repos           # dépôts où vous pouvez pousser
  api/health          # sonde de disponibilité (ping Discord)
  api/staff/*         # journal d'activité, réglages Discord, pilotage du bot
  staff/              # panel staff (accès contrôlé côté serveur)
components/
  ui/                 # primitives (button, card, badge, input, switch, spinner)
  staff/              # onglets Activité / Discord / Système
  SecretDoor.tsx      # porte cachée vers /staff (5 clics ou Konami)
lib/
  sanitize.mjs        # sanitisation partagée serveur + worker (ESM pur)
  extract/            # zip (yauzl v3) + rar (worker enfant) + tar (lecteur maison) + aperçu
  git.ts              # init/fetch/overlay/commit/push (token via GIT_ASKPASS)
  github.ts           # client REST GitHub (toujours avec le token de l'appelant)
  jobs.ts             # orchestrateur : extraction & push en tâche de fond
  session.ts          # cookie JWE chiffré
  db.ts               # SQLite (node:sqlite) : jobs, journal, réglages, sondes
  settings.ts         # réglages chiffrés (AES-256-GCM) — jeton Discord
  staff.ts            # allowlist STAFF_LOGINS
  discord/            # client (REST + Gateway), messages, moniteur de ping
scripts/rar-extract.mjs   # worker .rar isolé (WASM unrar, killable)
tests/                # vitest + fixtures zip/rar/tar + dépôt bare local
```

**Flux de traitement :** `queued → extracting → ready → pushing → done | failed`
(dossier de travail éphémère purgé automatiquement ; un redémarrage marque les
jobs interrompus comme échoués ; chaque étape alimente le journal d'activité).

---

## Déploiement

```bash
cp .env.example .env      # APP_URL=https://votre-domaine, secrets, DEV_AUTH absent
docker compose up -d --build
```

- Le callback OAuth doit correspondre à `APP_URL` : `https://domaine/api/auth/callback`.
- La base SQLite est montée dans un volume (`repodrop-data`) : jobs, journal
  d'activité, réglages Discord et historique de sondes y sont conservés.
- Le conteneur tourne en non-root, avec `git` et les certificats TLS.
- Le bot Discord a besoin d'un accès sortant vers `discord.com` (443) et vers
  `APP_URL` pour la sonde.

---

## Backlog (post-v1)

`.7z` · LFS pour fichiers > 100 Mo · sélection manuelle de fichiers ·
i18n EN · import par URL · scan antivirus · notifications Discord par canal
d'équipe.
