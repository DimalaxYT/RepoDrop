# RepoDrop

> **Vos archives de code, sur GitHub, en un glisser-déposer.**
> Un `.rar` ou un `.zip` → un dépôt GitHub. Sans terminal, sans clone, sans configuration git.

RepoDrop est un outil web (interface 100 % française) qui :

1. se connecte à **votre** GitHub (OAuth, scope `repo`) ;
2. reçoit votre **archive `.rar` / `.zip`** ;
3. l'extrait dans un **espace sandboxé** (chemins vérifiés, anti-bombes) ;
4. vous montre un **aperçu complet** avant tout envoi ;
5. **pushe** le contenu dans un dépôt neuf ou existant, avec votre identité GitHub.

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
```

Variables importantes :

| Variable | Rôle | Défaut |
|---|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App GitHub. **Important :** déclarer les scopes `repo` et `workflow` dans l'OAuth App (sans `workflow`, GitHub rejette les push qui touchent à `/.github/workflows/`). | — |
| `APP_URL` | URL publique (callback OAuth) | `http://localhost:3000` |
| `SESSION_SECRET` | Chiffrement du cookie de session | — |
| `DEV_AUTH=1` | Bouton « connexion directe » via `GH_TOKEN` du serveur (**dev uniquement**) | off |
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

1. **Connexion** avec GitHub (scopes `repo` et `workflow` — sinon GitHub rejette les push qui écrivent dans `.github/workflows/`). L'écran de connexion liste ces scopes et leur raison.
2. **Importer** → glisser-déposer du `.rar` / `.zip`.
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

---

## Sécurité & limites

| Risque | Protection |
|---|---|
| Zip-slip / path traversal (`../`, `C:\`, absolu) | Sanitisation systématique (`lib/sanitize.mjs`), **refus intégral** de l'archive en cas d'attaque |
| Bombes de décompression | Cumul des tailles déclarées **avant** écriture + compteur réel, `MAX_EXTRACT_MB` / `MAX_FILES` |
| Symlinks (zip & rar) | Écartés (zip) ou matérialisés en fichiers réguliers vides (rar) — aucun lien créé |
| Motif « fichier + ancêtre » (`up` puis `up/x`) | Contrôle structurel → archive refusée |
| `.git/` embarqué | Toujours ignoré (`.gitignore`, `.gitattributes` conservés) |
| Token GitHub | **Jamais en base, jamais en log** : cookie chiffré httpOnly (JWE A256GCM) ; push via `GIT_ASKPASS` (env), jamais dans les arguments de process |
| Rate-limit | 30 uploads/h par IP, 10 poussées/h par utilisateur (persistant en base) |
| Fichiers > 100 Mo | Avertissement dans l'aperçu (limite GitHub) |

Limite de taille par défaut : **200 Mo** uploadés, **500 Mo** décompressés, **20 000** fichiers.

---

## Tests

```bash
npm test
```

71 tests couvrent :

- sanitisation (traversal Unix/Windows, absolus, NUL, profondeur) ;
- extraction `.zip` réelle (fixtures construites avec `yazl` : nominal, bombes, symlinks, `.git`, limites) ;
- extraction `.rar` réelle via le **worker enfant** (fixtures RAR4/RAR5, unicode, mot de passe, volumes, symlink traversal) ;
- flux git complet (`init → fetch → overlay → commit → push`) contre un **dépôt bare local** ;
- détection de format (magic bytes) et chiffrement de session ;
- reconstruction de l'URL publique derrière un proxy (hôte, schéma, `Secure`).

CI : GitHub Actions (lint + typecheck + tests + build) sur chaque push/PR.

---

## Architecture

```
app/                  # Next.js App Router — pages FR + routes API
  api/auth/*          # OAuth GitHub (login, callback, logout, dev-login)
  api/upload          # réception multipart (busboy, streaming vers /tmp)
  api/jobs/[id]       # statut du job + lancement du push
  api/repos           # dépôts où vous pouvez pousser
lib/
  sanitize.mjs        # sanitisation partagée serveur + worker (ESM pur)
  extract/            # zip (yauzl v3) + rar (worker enfant) + aperçu
  git.ts              # init/fetch/overlay/commit/push (token via GIT_ASKPASS)
  github.ts           # client REST GitHub (toujours avec le token de l'appelant)
  jobs.ts             # orchestrateur : extraction & push en tâche de fond
  session.ts          # cookie JWE chiffré
  db.ts               # SQLite (node:sqlite, zéro dépendance native)
scripts/rar-extract.mjs   # worker .rar isolé (WASM unrar, killable)
tests/                # vitest + fixtures zip/rar + dépôt bare local
```

**Flux de traitement :** `queued → extracting → ready → pushing → done | failed`
(dossier de travail éphémère purgé automatiquement ; un redémarrage marque les
jobs interrompus comme échoués).

---

## Déploiement

```bash
cp .env.example .env      # APP_URL=https://votre-domaine, secrets, DEV_AUTH absent
docker compose up -d --build
```

- Le callback OAuth doit correspondre à `APP_URL` : `https://domaine/api/auth/callback`.
- La base SQLite est montée dans un volume (`repodrop-data`).
- Le conteneur tourne en non-root, avec `git` et les certificats TLS.

---

## Backlog (post-v1)

`.7z` / `.tar.gz` · LFS pour fichiers > 100 Mo · sélection manuelle de fichiers ·
i18n EN · import par URL · historique des imports · scan antivirus.
