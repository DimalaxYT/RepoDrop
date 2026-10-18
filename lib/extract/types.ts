/**
 * Types communs aux extracteurs (.zip en mémoire serveur, .rar en processus
 * enfant) — le résultat brut, avant construction de l'aperçu.
 */

export interface ExtractLimits {
  /** Poids max du contenu décompressé */
  maxExtractBytes: number;
  /** Nombre max de fichiers */
  maxFiles: number;
  /** Profondeur max d'arborescence */
  maxDepth: number;
  /** Longueur max d'un chemin relatif */
  maxPathLength: number;
}

export interface ExtractIgnored {
  symlinks: number;
  systemFiles: number;
  gitDirs: number;
  outside: number;
}

export interface ExtractResult {
  fileCount: number;
  totalSize: number;
  /** Fichiers réellement écrits sur disque */
  entries: { path: string; size: number }[];
  ignored: ExtractIgnored;
}

export const emptyIgnored = (): ExtractIgnored => ({
  symlinks: 0,
  systemFiles: 0,
  gitDirs: 0,
  outside: 0,
});
