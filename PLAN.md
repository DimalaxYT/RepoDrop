# Plan — Importeur d'archives de code vers GitHub

> **Working title :** *RepoDrop* (nom retenu ✅)
> **Objectif :** un outil web où l'utilisateur se connecte avec GitHub, dépose une archive `.rar` / `.zip` de code, choisit la destination, et le contenu est poussé sur GitHub. Zéro ligne de commande, zéro clone, zéro « truc chiant ».

## ✅ Statut — v1 LIVRÉE (2026-10-18)

| Jalon | État | Notes |
|---|---|---|
| M0 — Base & CI | ✅ | Next.js 15 + TS + ESLint/Prettier, CI GitHub Actions |
| M1 — Auth GitHub | ✅ | OAuth (scope `repo`) + mode dev (`DEV_AUTH=1`) |
| M2 — Upload & extraction | ✅ | busboy streaming, yauzl v3, worker RAR isolé, limites |
| M3 — Push GitHub | ✅ | dépôt neuf/existant, branche dédiée, jobs SQLite, statut live |
| M4 — Durcissement | ✅ | anti zip-slip/bombes, rate-limit, purge auto, logs sans secrets |
| M5 — UI & déploiement | ✅ | UI FR complète, Docker/compose, README, `.env.example` |

**Tests :** 60/60 (sanitize, zip réel, rar réel via fixtures, git push sur bare local, session, magic bytes, URL publique derrière proxy).
**E2E manuel :** upload zip « piègé » (.git/node_modules/.DS_Store/racine unique) → aperçu exact → push réel sur `DimalaxYT/adazdjadka-l` branche dédiée → vérifié (fichiers à la racine, auteur correct, `main` intact) → branche de test supprimée. Refus 415 (magic bytes) et 401 vérifiés.



---

## 1. Vision

| Aujourd'hui (le problème) | Avec l'outil (la solution) |
|---|---|
| Dézipper, cloner le dépôt, copier les fichiers, `git add/commit/push`, gérer les conflits, configurer les credentials… | Se connecter → glisser l'archive → choisir le dépôt → cliquer « Pousser ». |

**Cible :** devs qui reçoivent du code en `.rar` (cours, collègues, clients, backups) et veulent le mettre sur GitHub rapidement.
**Objectif qualité :** produit abouti et déployé (pas un prototype).

---

## 2. Périmètre v1

### Ce qu'on fait
1. **Connexion GitHub** (OAuth App, scope `repo`) + session sécurisée.
2. **Import d'archive** `.rar` et `.zip` :
   - glisser-déposer, validation extension **et** magic bytes ;
   - taille max configurable (défaut **200 Mo**).
3. **Extraction sûre** puis **aperçu** avant push :
   - nombre de fichiers, poids total, arborescence sommaire ;
   - détection du « dossier racine unique » (ex: `mon-projet/…`) → case à cocher pour le stripper ;
   - aperçu des fichiers ignorés (`.git/`, `__MACOSX/`, `.DS_Store`).
4. **Choix de la destination** :
   - **Créer un nouveau dépôt** : nom, public/privé ;
   - **Pousser dans un dépôt existant** : liste des dépôts où l'utilisateur a les droits d'écriture (API GitHub), push sur la branche par défaut ;
   - option « créer une branche dédiée » pour ne pas toucher à la branche par défaut.
5. **Push réel** des fichiers : commit créé avec l'identité GitHub de l'utilisateur (`login <login@users.noreply.github.com>`).
6. **Suivi en direct** : page de statut (file d'attente → extraction → push → terminé) avec bouton « Ouvrir sur GitHub ».
7. **UI en français**, landing page soignée, erreurs explicites en FR (archive corrompue, protégée par mot de passe, trop grosse, quota GitHub…).

### Hors périmètre v1 (backlog)
Formats `.7z` / `.tar.gz` · LFS pour fichiers > 100 Mo · sélection manuelle de fichiers à exclure · scan antivirus · i18n EN · multiples comptes GitHub · webhooks · import depuis une URL · historique des imports.

---

## 3. Choix techniques (et pourquoi)

| Sujet | Choix | Pourquoi / alternative écartée |
|---|---|---|
| Stack | **Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui** | Monolithe full-stack : landing + API + UI dans un seul déploiement. Alternative (React + FastAPI) = 2 codebases à maintenir pour rien ici. |
| Extraction `.zip` | **`yauzl`** (streaming) + sanitisation maison | Streaming = pas de buffer en mémoire, contrôle total anti zip-slip. |
| Extraction `.rar` | **`node-unrar-js`** (unrar compilé en WASM) | Aucun binaire système requis, compatible RAR4/RAR5. Filet de repli : `unar` installé dans l'image Docker. |
| Push Git | **Binaire `git` en conteneur** (`init/add/commit/push` dans un dossier temporaire) | Simple, rapide, robuste même pour des milliers de fichiers. Alternative : GitHub Git Data API (beaucoup d'appels API pour les gros dépôts). |
| Jobs | **Table SQLite (Drizzle) + worker in-process** (concurrence 1–2) | État persistant et observable sans Redis. Alternative BullMQ = complexité inutile en v1. |
| Sessions / token | **Cookie chiffré httpOnly** (iron-session / `jose`) | Token GitHub jamais stocké en base, jamais loggé. |
| Upload | **`busboy`** (multipart en streaming vers `/tmp`) | Pas de OOM sur les gros fichiers. |
| Déploiement | **Docker multi-stage (node:22-slim + git) + docker-compose** | Déployable sur n'importe quel VPS ; Fly/Render possibles aussi. |

---

## 4. Architecture & flux

```
┌─────────────┐   OAuth    ┌──────────────────────────────┐
│  Navigateur  │◄──────────►│  GitHub (OAuth + API + push) │
└──────┬──────┘            └──────────────▲───────────────┘
       │ 1. upload .rar/.zip              │ 5. git push (token user)
       ▼                                  │
┌─────────────────────────────────────────┴───────────┐
│ App Next.js (Node)                                  │
│  /api/auth/*     → OAuth + session                  │
│  /api/upload     → busboy → /tmp/jobs/<id>/archive  │
│  /api/jobs/*     → statut (polling 1 s)             │
│  Worker          → extraction → preview → git push  │
│  SQLite          → jobs (état, pas de tokens)       │
└─────────────────────────────────────────────────────┘
```

**Flux utilisateur :**
`Connexion GitHub` → `Déposer l'archive` → `Aperçu + choix de la destination` → `Pousser` → `Lien vers le dépôt` ✅

**Pipeline (machine) :**
`queued → extracting → ready → pushing → done | failed`
Chaque job a un répertoire unique, purgé en fin de vie (finally) + sweeper TTL (1 h) pour les orphelins.

---

## 5. Sécurité & limites

- **Anti zip-slip** : normalisation de chaque chemin d'entrée, rejet de `../`, chemins absolus, Windows (`C:\`), et `..` après résolution.
- **Anti bombes** : max **20 000 fichiers**, **500 Mo** décompressés, ratio compression **200:1** max.
- **Symlinks** : ignorés (pas de follow hors de la racine du job).
- **Nettoyage systématique** avant push : `.git/`, `__MACOSX/`, `.DS_Store` (jamais de `.git` embarqué — GitHub le rejeterait de toute façon).
- **Droits** : dépôt existant vérifié (`permissions.push`) côté API avant d'accepter la cible.
- **Rate-limit** : par IP + par utilisateur (ex. 10 poussées/h).
- **Cookies** : `httpOnly`, `Secure`, `SameSite=Lax`. Aucun token en log ni en base.
- **Run en non-root** dans le conteneur, `/tmp` éphémère.

---

## 6. Structure du projet

```
app/
  page.tsx                  # landing
  login/ callback/          # OAuth
  app/                      # espace connecté
    import/                 # upload + aperçu + destination
    jobs/[id]/              # statut en direct
  api/
    auth/[...]/             # OAuth + session
    upload/ jobs/ repos/    # upload, statut, liste des dépôts cibles
lib/
  github.ts  session.ts  db/
  extract/ (zip.ts, rar.ts, sanitize.ts)
  git/ (push.ts, preview.ts)
  limits.ts  rate-limit.ts
tests/                      # fixtures .zip/.rar + tests d'intégration
Dockerfile  docker-compose.yml  .env.example  README.md  PLAN.md
```

---

## 7. Jalons

| # | Jalon | Contenu | Effort estimé |
|---|---|---|---|
| M0 | Base & CI | Scaffold Next.js + TS + ESLint/Prettier + tests, CI GitHub Actions, structure des dossiers | 0,5 j |
| M1 | Auth GitHub | OAuth flow, session chiffrée, mode dev (mock login) pour développer sans OAuth App | 0,5–1 j |
| M2 | Upload & extraction | busboy, yauzl + node-unrar-js, sanitisation, limites, aperçu | 1–2 j |
| M3 | Push GitHub | Création de dépôt, push dans dépôt existant, worker + jobs SQLite, page statut | 1 j |
| M4 | Durcissement | Rate-limit, erreurs FR, purge des jobs, logs structurés (sans secrets) | 1 j |
| M5 | UI & déploiement | Landing, polish shadcn, Docker/compose, `.env.example`, README (setup OAuth App) | 1 j |

**Total ≈ 5–7 jours.** Chaque jalon se termine par un commit pushé sur la branche en cours.

---

## 8. Tests

- **Unitaires** : sanitisation de chemins, détection de bombes, détection dossier racine unique, stripping.
- **Intégration** : fixtures `.zip` / `.rar` réelles (valide, corrompue, protégée, zip-slip, bombes) ; push vers un dépôt git **bare local** (pas de GitHub requis en CI).
- **E2E manuel** : checklist du flux complet (voir README), + vérification réelle sur un dépôt de test.
- **CI** : lint + typecheck + tests à chaque push.

---

## 9. Configuration (`.env.example`)

```bash
GITHUB_CLIENT_ID=...        # OAuth App GitHub
GITHUB_CLIENT_SECRET=...
APP_URL=https://...         # callback: {APP_URL}/callback
SESSION_SECRET=...          # 32+ octets aléatoires
MAX_UPLOAD_MB=200
MAX_EXTRACT_MB=500
MAX_FILES=20000
DEV_AUTH=1                  # mock login en dev seulement
```

> L'OAuth App GitHub devra être créée par toi sur github.com/settings/apps (étapes dans le README) — je ne touche jamais à tes identifiants.

---

## 10. Risques & atténuations

| Risque | Atténuation |
|---|---|
| Fichier > 100 Mo refusé par GitHub | Détection avant push + message clair ; LFS = backlog. |
| RAR exotique/non supporté par le WASM | Repli `unar` dans le Dockerfile ; sinon erreur explicite. |
| Gros archive = job long | Extraction streaming, polling de statut, concurrence limitée. |
| Token volé / fuite | Cookie chiffré only, jamais de log, rotation à chaque login. |
| Répertoires temporaires qui s'accumulent | Purge `finally` + sweeper TTL. |

---

## 11. Critères de succès (v1)

1. Un `.rar` de 50 Mo → dépôt GitHub privé créé en < 2 min, sans terminal.
2. Un `.zip` poussé dans un dépôt existant sans casser la branche par défaut (option branche dédiée).
3. Aucun chemin malveillant ni bombes ne ressort du `/tmp`.
4. Déployé en HTTPS via docker-compose sur un VPS, CI verte.

---

## 12. Questions ouvertes (à trancher avant/pendant M0)

1. **Nom du produit** — suggestions : *RepoDrop*, *RAR2Repo*, *Archive2Repo*, *PushMyCode* ? (reste modifiable partout en 1 constante)
2. **UI 100 % FR** pour la v1, ou FR + EN dès maintenant ?
3. **node_modules dans les archives** : le garder, le strip par défaut, ou case à cocher dans l'aperçu ? *(ma reco : case à cocher, strip par défaut)*

---

## 13. v1.1 — ajoutée après la v1

Ce qui a été livré en plus du périmètre initial :

| Ajout | Détail |
|---|---|
| **Refonte visuelle** | Thème enrichi (halos animés, grille, dégradés, verre dépoli), hero en deux colonnes avec maquette animée du produit, bandeau de chiffres, cartes « formats » et « sécurité », pied de page global en colonnes, pages connexion/import retravaillées. |
| **`.tar` / `.tar.gz`** | Lecteur ustar/GNU/PAX maison (`lib/extract/tar.ts`), zéro dépendance native, streaming + gunzip à la volée ; détection par magic bytes (offset 257) avec décompression partielle pour les `.tar.gz` ; mêmes garde-fous que zip/rar (traversal, bombes, symlinks, hardlinks, `.git`). |
| **Bot Discord** | Client sans dépendance (REST + Gateway), sonde de disponibilité toutes les N minutes (défaut 10) avec embed d'état, alerte en cas de panne (avec mention), annonce de chaque push, historique des sondes en base. |
| **Panel staff (`/staff`)** | Accès par allowlist `STAFF_LOGINS` ; onglets **Activité** (qui a poussé quoi, quand, avec dépôt/branche/SHA/volume/IP, filtres, export CSV), **Discord** (jeton configurable depuis le dashboard, write-only et chiffré), **Système** (disponibilité + configuration). |
| **Porte cachée** | Point invisible du pied de page (5 clics) ou séquence Konami → `/staff` ; l'accès réel reste vérifié côté serveur. |
| **Journal d'activité** | Table `events` (push, upload, login/logout, settings, discord) + rétention 90 jours ; table `pings` pour l'historique de disponibilité (7 jours). |
| **`GET /api/health`** | Sonde publique utilisée par le bot (et par le healthcheck Docker). |

Tests : **145** (contre 71 en v1) — extraction tar réelle + hostile, détection de
format, Discord (messages, Gateway, moniteur), réglages chiffrés, accès staff.

### Verrou par mot de passe du panel staff

| Ajout | Rôle |
|---|---|
| `hashStaffPassword` / `verifyStaffPasswordHash` (`lib/staff.ts`) | empreinte scrypt salée auto-descriptive (`scrypt$N,r,p$salt$hash`), comparaison en temps constant, aucune exception sur empreinte malformée |
| `isStaffPasswordSet` / `verifyStaffPassword` / `setStaffPassword` | amorçage par `STAFF_PASSWORD`, priorité à la base, suppression par chaîne vide |
| `staffAccess()` | distingue `denied` / `locked` / `granted` pour choisir l'écran |
| `checkStaff()` | **point de contrôle unique** : allowlist puis mot de passe, pour la page et toutes les API |
| `staffUnlocked` dans `SessionData` | déverrouillage porté par le cookie chiffré, perdu à la déconnexion |
| `POST/GET /api/staff/unlock` | déverrouille, verrouille (`action:"lock"`), limite à 6 essais / 15 min par IP |
| `POST/GET /api/staff/security` | définit, change (mot de passe actuel exigé) ou supprime le verrou |
| `StaffGate` | écran de saisie affiché à un compte staff non déverrouillé |
| `StaffPassword` + onglet **Sécurité** | état du verrou, changement, suppression, « Verrouiller maintenant » |
| porte du pied de page | le logo du footer mène à `/staff` ; celui de l'en-tête est redevenu un lien d'accueil |

158 tests couvrent l'ensemble (dont 12 sur le mot de passe : empreintes,
amorçage, priorité base/environnement, seuil de blocage par IP).

### Navigateur de dépôts (`/repos`)

| Ajout | Rôle |
|---|---|
| `listRepos` / `getRepoInfo` / `listBranches` | liste paginée (plafond borné, `truncated` signalé), détails, branches |
| `getTree` / `getBlob` | arborescence chargée dossier par dossier ; fichier décodé en UTF-8 strict |
| `safeRepoPath` / `assertRepoName` / `safeRef` | validation avant tout appel réseau (`..`, absolu, octet nul, longueurs) |
| `updateRepo` / `deleteRepo` | renommage, visibilité, description ; suppression avec confirmation exacte |
| `MAX_VIEW_BYTES` (512 Ko) | plafond d'aperçu : rien n'est transféré au-delà |
| `FetchImpl` injectable + `GITHUB_API_URL` | tests sans réseau et vérification contre une fausse API |
| `/api/repos`, `/api/repos/[owner]/[repo]{,/tree,/blob,/branches}` | 5 routes, toutes derrière la session |
| `RepoBrowser` / `RepoDetail` / `RepoActions` | liste + filtres, arborescence + aperçu, actions rapides |
| codes `BAD_PATH` et `CONFIRM_MISMATCH` | messages FR justes (les codes « archive » et « push » ne s'appliquaient pas) |
| scope OAuth `delete_repo` | indispensable à la suppression ; sinon GitHub répond 404 |

188 tests couvrent l'ensemble, dont 30 sur le client GitHub (validation des
chemins, pagination, tri, base64, détection binaire, payloads PATCH/DELETE,
traduction des erreurs, base d'API configurable).

### Téléchargement d'un dépôt en archive (.zip / .tar.gz)

| Ajout | Rôle |
|---|---|
| `ghRaw` | requête brute vers l'API GitHub, même traitement d'erreur que `gh`, pour les réponses non-JSON |
| `streamArchive` | `zipball` / `tarball` de GitHub, corps renvoyé en flux (jamais bufferisé) |
| `archiveFilename` | nom de fichier assaini : aucun séparateur ni caractère de contrôle ne sort du `Content-Disposition` |
| `MAX_ARCHIVE_MB` (250 Mo) | taille annoncée vérifiée **avant** le premier octet transféré |
| code `ARCHIVE_TOO_BIG` | message juste : `TOO_BIG` parlait de « contenu décompressé » et de `node_modules` |
| `/api/repos/[owner]/[repo]/archive` | `?format=zip\|tar.gz&ref=`, lien direct donc progression gérée par le navigateur |
| boutons `.zip` / `.tar.gz` | dans l'en-tête du dépôt, suivent la branche sélectionnée |

196 tests couvrent l'ensemble, dont 8 sur l'archive (nom de fichier, endpoint
par format, streaming octet pour octet, plafond de taille, dépôt vide, quota,
validation avant appel).

### Fiabilisation : tests manquants, compteurs persistés, API de test versionnée

Trois faiblesses structurelles corrigées (aucun changement d'interface).

| Sujet | Avant | Après |
| --- | --- | --- |
| `lib/ratelimit.ts` | fenêtre glissante sur une `Map` en mémoire | horodatages stockés dans la table `buckets` (SQLite), durée de vie = fenêtre |
| verrou du panel staff | compteur d'essais en mémoire | même table `buckets`, clé `staff:unlock:<ip>` |
| redémarrage du serveur | **remettait les 6 essais à zéro** | le verrou survit (vérifié : 429 après redémarrage, compteur continu) |
| plusieurs processus | chaque instance avait ses compteurs | état partagé via la base |
| `lib/jobs.ts` | aucun test | `sanitizeBranch` / `sanitizeRepoName` / `jobOwnedBy` testés |
| `lib/ratelimit.ts` | aucun test | 13 tests (fenêtre, expiration, délai, persistance, `clientIp`) |
| fausse API GitHub | script hors dépôt, non reproductible | `tests/mock-github.mjs` versionné, exécuté par la CI |
| `sanitizeBranch` | `a//b` accepté (refname invalide pour git) | aligné sur `git check-ref-format` : `//`, `@{`, point final refusés |

Vérification de bout en bout (serveur de production + fausse API) : 6 mots de
passe erronés → `429` ; **après redémarrage du serveur, la même IP reçoit
toujours `429`** (échéance poursuivie, 870 s restantes sur 900), une autre IP
n'est pas affectée, et les deux lignes `staff:unlock:*` sont présentes en base.

252 tests couvrent l'ensemble, dont 56 nouveaux : 13 sur le rate-limit persisté,
15 sur les garde-fous de la couche jobs, 28 en intégration HTTP réelle contre la
fausse API GitHub.

### Durcissement HTTP et configuration

| Sujet | Avant | Après |
| --- | --- | --- |
| En-têtes de sécurité | `nosniff` sur 2 routes de téléchargement seulement | CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-DNS-Prefetch-Control`, HSTS sur **toutes** les réponses |
| Logique des en-têtes | — | `lib/security-headers.ts`, testée (17 tests) ; `next.config.ts` ne fait que la câbler |
| `SESSION_SECRET` absent | clé tirée au hasard **en silence** : sessions invalidées et jeton Discord chiffré illisible au redémarrage | serveur **refusé** en production avec un message explicite ; avertissement en dev |
| Bouton « recharger » | icône seule, `title` uniquement | `aria-label` ajouté |

Deux pièges documentés dans le code plutôt que laissés à découvrir :

- `script-src`/`style-src` gardent `'unsafe-inline'` (amorçage Next.js) ;
  `'unsafe-eval'` n'est ajouté qu'en développement, pour React Refresh.
- `FRAME_ANCESTORS` est lu **au build** : Next.js résout `headers()` pendant
  `next build` et fige le résultat dans `.next/routes-manifest.json`. Vérifié
  dans les deux sens — posée au runtime seulement, la variable n'a aucun effet ;
  posée à la compilation, `frame-ancestors 'self'` et `X-Frame-Options`
  apparaissent. Par défaut aucune directive n'est émise, pour ne pas casser
  l'affichage dans une iframe.

269 tests couvrent l'ensemble, dont 17 sur les en-têtes de sécurité.

### Navigation /repos partageable et restaurable

Avant, dépôt sélectionné, branche, dossier et fichier vivaient dans des états
React locaux : un rafraîchissement ou un lien partagé perdait le contexte.
L'état est maintenant sérialisé dans l'URL :

```text
/repos?repo=dimalaxyt%2Fmon-projet&ref=main&path=src&file=src%2Findex.ts
```

- dépôt, branche (`ref`), dossier (`path`), fichier (`file`), filtre (`q`), tri
  (`sort`) et filtre propriétaire (`mine`) ; valeurs par défaut omises ;
- ouvrir un dépôt, changer de branche/dossier/fichier ajoute une entrée à
  l'historique ; filtre et tri remplacent l'entrée courante, sans une entrée par
  frappe ; retour/avance du navigateur suit les changements ;
- un lien direct réhydrate le dépôt, l'arborescence et le contenu du fichier ;
- validation stricte des noms de dépôt, refs et chemins avant chargement ; les
  chemins absolus, `..`, `.` et séparateurs abusifs sont ignorés ;
- `lib/repo-view.ts` est la logique pure testée, `tests/repo-view.test.ts` ajoute
  21 cas, dont aller-retour Unicode, chemin hostile et lien complet.

Vérifié en HTTP : `/repos` affiche la liste ; `/repos?repo=…&ref=main&path=src&file=src/index.ts`
rend l'écran détail au lieu de la liste, répond 200 et inclut le fichier dans
l'état RSC. Build, lint, typecheck et 290 tests passent.
