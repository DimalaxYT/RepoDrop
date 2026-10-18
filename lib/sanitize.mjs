/**
 * Sanitisation des chemins d'archives — brique de sécurité partagée entre :
 *  - le serveur (extraction .zip)
 *  - le processus enfant (extraction .rar)
 * Fichier ESM pur (.mjs) pour être importable TEL QUEL par Node côté script
 * d'extraction, sans compilation TypeScript.
 *
 * On rejette : chemins absolus (Unix/Windows/UNC), traversal (`..`),
 * caractères de contrôle / NUL, chemins trop longs ou trop profonds.
 */

/**
 * @typedef {{ ok: true, path: string, isDir: boolean }}
 *          | {{ ok: false, reason: "absolute" | "traversal" | "invalid" | "too_deep" | "too_long" }}
 * SanitizeResult
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * @param {string} rawName
 * @param {{ maxDepth: number, maxPathLength: number }} limits
 * {ok:true,path,isDir} | {ok:false,reason}
 */
export function sanitizeEntryPath(rawName, limits) {
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  if (CONTROL_CHARS.test(rawName)) {
    return { ok: false, reason: "invalid" };
  }
  if (rawName.length > limits.maxPathLength) {
    return { ok: false, reason: "too_long" };
  }

  // Les séparateurs Windows sont normalisés en "/" (`..\x` ne doit pas passer).
  const name = rawName.replace(/\\/g, "/");

  // Absolu AVANT nettoyage : Unix, drive Windows, UNC.
  if (
    name.startsWith("/") ||
    name.startsWith("//") ||
    /^[a-zA-Z]:/.test(name) ||
    rawName.startsWith("\\\\")
  ) {
    return { ok: false, reason: "absolute" };
  }

  const isDir = name.endsWith("/");
  const segments = name.split("/");
  const safe = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return { ok: false, reason: "traversal" };
    if (/^[a-zA-Z]:$/.test(seg)) return { ok: false, reason: "invalid" };
    safe.push(seg);
  }

  if (safe.length === 0) return { ok: false, reason: "invalid" };
  if (safe.length > limits.maxDepth) return { ok: false, reason: "too_deep" };

  return { ok: true, path: safe.join("/") + (isDir ? "/" : ""), isDir };
}

/** Fichiers système / bruit : toujours ignorés (pas comptés comme fichiers). */
export function isSystemNoise(path) {
  const base = path.split("/").filter(Boolean).pop() ?? "";
  return base === ".DS_Store" || base === "Thumbs.db" || base === "desktop.ini";
}

/** Segment `.git` exact quelque part (dossier git interdit à l'import). */
export function hasGitSegment(path) {
  return path.split("/").some((s) => s === ".git");
}

/** Segment `node_modules` quelque part. */
export function hasNodeModulesSegment(path) {
  return path.split("/").some((s) => s === "node_modules");
}
