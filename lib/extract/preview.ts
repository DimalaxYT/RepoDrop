/**
 * Construit l'aperçu affiché à l'utilisateur à partir du résultat d'extraction.
 *
 * AUCUNE troncature : l'arborescence est complète (tous les fichiers, toutes
 * les profondeurs, plus les dossiers ancêtres synthétisés), en ordre DFS
 * (dossiers puis fichiers, alphabétiques) — l'utilisateur voit exactement
 * tout ce qui sera poussé.
 */
import { hasNodeModulesSegment } from "../sanitize.mjs";
import type { ArchivePreview, PreviewEntry } from "../types";
import type { ExtractResult } from "./types";

const GH_MAX_FILE = 100 * 1024 * 1024; // limite GitHub par fichier

/** Nœud de l'arborescence reconstruite. */
interface TreeNode {
  path: string; // dossier : "src/" · fichier : "src/app.ts"
  size: number;
  isDir: boolean;
  children: Map<string, TreeNode>;
}

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

  // --- Arborescence COMPLÈTE ---
  const root: TreeNode = { path: "", size: 0, isDir: true, children: new Map() };

  const ensureDir = (dirPath: string): TreeNode => {
    let node = root;
    let acc = "";
    for (const seg of dirPath.split("/")) {
      if (!seg) continue;
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = { path: `${acc}/`, size: 0, isDir: true, children: new Map() };
        node.children.set(seg, child);
      }
      if (!child.isDir) return child; // conflit (inatteignable : refusé en amont)
      node = child;
    }
    return node;
  };

  for (const f of files) {
    const lastSlash = f.path.lastIndexOf("/");
    const parent =
      lastSlash === -1 ? root : ensureDir(f.path.slice(0, lastSlash));
    if (parent.isDir && !parent.children.has(f.path.slice(lastSlash + 1))) {
      parent.children.set(f.path.slice(lastSlash + 1), {
        path: f.path,
        size: f.size,
        isDir: false,
        children: new Map(),
      });
    }
  }

  // Aplat pré-ordre : à chaque niveau, dossiers puis fichiers, alphabétiques.
  const tree: PreviewEntry[] = [];
  const walk = (node: TreeNode): void => {
    const kids = [...node.children.values()];
    const dirs = kids.filter((k) => k.isDir).sort(byName);
    const filesOnly = kids.filter((k) => !k.isDir).sort(byName);
    for (const child of [...dirs, ...filesOnly]) {
      tree.push({ path: child.path, size: child.isDir ? 0 : child.size });
      if (child.isDir) walk(child);
    }
  };
  walk(root);

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

function byName(a: TreeNode, b: TreeNode): number {
  return a.path.localeCompare(b.path, "fr");
}
