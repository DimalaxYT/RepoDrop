/**
 * Types partagés entre le serveur (worker d'extraction / push) et le client
 * (pages de statut en direct). Aucune dépendance serveur ici.
 */

export type JobStatus =
  | "queued" // upload accepté, en attente
  | "extracting" // extraction en cours
  | "ready" // aperçu disponible, en attente de « Pousser »
  | "pushing" // push GitHub en cours
  | "done" // poussé ✅
  | "failed"; // échec (error contient le message FR)

export type ArchiveFormat = "zip" | "rar";

export interface PreviewEntry {
  /** Chemin relatif (dossier avec trailing /) */
  path: string;
  size: number;
}

export interface ArchivePreview {
  fileCount: number;
  totalSize: number;
  /** Contenu du dossier racine s'il n'y a qu'un seul dossier (ex: "mon-projet/") */
  singleRootDir: string | null;
  /** Chemins ignorés pendant l'extraction (sécurité / bruit) */
  ignored: {
    symlinks: number;
    systemFiles: number; // .DS_Store, Thumbs.db, ...
    gitDirs: number; // dossiers .git embarqués
    outside: number; // tentatives de path traversal
  };
  /** Arborescence COMPLÈTE (tous les fichiers, toutes profondeurs, dossiers ancêtres) */
  tree: PreviewEntry[];
  /** true si au moins un dossier node_modules présent (strippable) */
  hasNodeModules: boolean;
  /**
   * Fichiers > 100 Mo : GitHub refusera le push pour ceux-ci
   * (avertissement, on tente quand même — GitHub Enterprise : autre limite).
   */
  tooLargeForGitHub: { count: number; examples: PreviewEntry[] };
}

export interface PushOptions {
  /** "new" = créer un dépôt, "existing" = pousser dans un dépôt existant */
  mode: "new" | "existing";
  /** mode new */
  name?: string;
  private?: boolean;
  /** mode existing : "owner/repo" */
  repo?: string;
  /** Créer une branche dédiée plutôt que de pousser sur la branche par défaut */
  dedicatedBranch?: boolean;
  branchName?: string;
  /** Inclure les dossiers node_modules (strippés par défaut) */
  includeNodeModules?: boolean;
  /** Retirer le dossier racine unique (ex: "mon-projet/") — défaut true */
  stripRoot?: boolean;
  /** Message de commit (défaut : message auto) */
  commitMessage?: string;
}

export interface JobRecord {
  id: string;
  login: string;
  filename: string;
  format: ArchiveFormat | null;
  status: JobStatus;
  error: string | null;
  preview: ArchivePreview | null;
  push: {
    url: string; // URL du dépôt
    branch: string;
    commitSha?: string;
    created?: boolean; // dépôt créé par nous
  } | null;
  archiveSize: number;
  createdAt: number;
  updatedAt: number;
}

/** Réponse de GET /api/jobs/[id] */
export interface JobResponse {
  job: JobRecord;
}
