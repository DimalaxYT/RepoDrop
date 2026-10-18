/**
 * Construit l'aperçu affiché à l'utilisateur à partir du résultat d'extraction.
 */
import { hasNodeModulesSegment } from "../sanitize.mjs";
import type { ArchivePreview, PreviewEntry } from "../types";
import type { ExtractResult } from "./types";

const GH_MAX_FILE = 100 * 1024 * 1024; // limite GitHub par fichier
const TREE_CAP = 400;

export function buildPreview(res: ExtractResult): ArchivePreview {
  const files = res.entries;

  // --- Dossier racine unique ? (ex: toutes les entrées sous "mon-projet/") ---
  let singleRootDir: string | null = null;
  if (files.length > 0) {
    const firsts = new Set<string>();
    let hasTopFile = false;
    for (const f of files) {
      const i = f.path.indexOf("/");
      if (i === -1) hasTopFile = true;
      else firsts.add(f.path.slice(0, i));
    }
    if (firsts.size === 1 && !hasTopFile) {
      singleRootDir = [...firsts][0];
    }
  }

  // --- Échantillon d'arborescence : profondeur <= 2, dossiers d'abord ---
  const dirSet = new Set<string>();
  const fileItems: PreviewEntry[] = [];
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length && i <= 2; i++) {
      dirSet.add(parts.slice(0, i).join("/") + "/");
    }
    if (parts.length <= 2) fileItems.push({ path: f.path, size: f.size });
    if (dirSet.size + fileItems.length > TREE_CAP * 2) break;
  }
  const dirs: PreviewEntry[] = [...dirSet].map((p) => ({ path: p, size: 0 }));
  dirs.sort((a, b) => a.path.localeCompare(b.path, "fr"));
  fileItems.sort((a, b) => a.path.localeCompare(b.path, "fr"));
  const tree = [...dirs, ...fileItems].slice(0, TREE_CAP);

  // --- node_modules présent ? ---
  const hasNodeModules = files.some((f) => hasNodeModulesSegment(f.path));

  // --- Fichiers trop gros pour GitHub (> 100 Mo) ---
  const tooLarge = files.filter((f) => f.size > GH_MAX_FILE);
  const tooLargeForGitHub = {
    count: tooLarge.length,
    examples: tooLarge.slice(0, 3).map((f) => ({ path: f.path, size: f.size })),
  };

  return {
    fileCount: res.fileCount,
    totalSize: res.totalSize,
    singleRootDir,
    ignored: res.ignored,
    tree,
    hasNodeModules,
    tooLargeForGitHub,
  };
}
