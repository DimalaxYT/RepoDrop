#!/usr/bin/env node
/**
 * Worker d'extraction .rar — exécuté dans un PROCESSUS ENFANT :
 *  - l'archive est chargée en RAM (WASM unrar) loin du serveur principal ;
 *  - on peut tuer le process en cas de timeout/fuite sans impacter l'app ;
 *  - sortie : UNE ligne JSON sur stdout, code exit 0 (ok) / 1 (erreur).
 *
 * Usage : node scripts/rar-extract.mjs <archive> <destDir> <maxBytes> <maxFiles> <maxDepth> <maxPathLen>
 *
 * Réutilise lib/sanitize.mjs — source unique de sanitisation.
 */
import fs from "node:fs";
import path from "node:path";
import { createExtractorFromData } from "node-unrar-js";
import {
  sanitizeEntryPath,
  isSystemNoise,
  hasGitSegment,
} from "../lib/sanitize.mjs";

const [archive, destDir, maxBytesS, maxFilesS, maxDepthS, maxPathLenS] =
  process.argv.slice(2);

const limits = {
  maxDepth: Number(maxDepthS) || 64,
  maxPathLength: Number(maxPathLenS) || 1000,
};
const maxExtractBytes = Number(maxBytesS) || 500 * 1024 * 1024;
const maxFiles = Number(maxFilesS) || 20_000;

/** Erreur métier avec code (aligné sur lib/errors.ts). */
class Fail extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail) {
  throw new Fail(code, detail);
}

function mapUnrarError(e) {
  if (e instanceof Fail) throw e;
  const reason = e?.reason ?? "";
  const detail = e?.file ? `${e.message} (${e.file})` : String(e?.message ?? e);
  if (reason === "ERAR_MISSING_PASSWORD" || reason === "ERAR_BAD_PASSWORD") {
    fail("ENCRYPTED", detail);
  }
  if (reason === "ERAR_NO_MEMORY") fail("TOO_BIG", detail);
  // ERAR_BAD_ARCHIVE / ERAR_UNKNOWN_FORMAT / ERAR_BAD_DATA / divers
  fail("CORRUPT", detail);
}

async function main() {
  if (!archive || !destDir) fail("INTERNAL", "arguments manquants");

  // Chargement exact de l'archive (attention au pool de Buffer de Node).
  const buf = fs.readFileSync(archive);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const extractor = await createExtractorFromData({ data }).catch((e) => {
    fail("CORRUPT", String(e?.message ?? e));
  });

  // --------------------------------------------------------------- patch lib
  // node-unrar-js (v2.0.2) : pour les entrées SYMLINK, le côté C++ n'appelle
  // jamais create() → la map dataFiles n'a pas la clé → TypeError « undefined
  // .file » dans getFiles() au moment de readAll(). On injecte un stub vide
  // pour les clés manquantes : le symlink devient un fichier régulier vide,
  // ce qui est sûr (aucun lien n'est jamais créé sur disque).
  const stubDataFile = () => {
    let pos = 0;
    return {
      size: 0,
      read: () => null,
      readAll: () => new Uint8Array(0),
      write: () => true,
      tell: () => pos,
      seek: (p) => {
        pos = typeof p === "number" ? p : 0;
        return true;
      },
      flatten: () => {},
    };
  };
  if (extractor && extractor.dataFiles) {
    const real = extractor.dataFiles;
    extractor.dataFiles = new Proxy(real, {
      get(target, prop) {
        if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(target, prop)) {
          return target[prop];
        }
        if (typeof prop === "string") return { file: stubDataFile(), fd: 0 };
        return Reflect.get(target, prop);
      },
    });
  }

  const ignored = { symlinks: 0, systemFiles: 0, gitDirs: 0, outside: 0 };

  // ---------- Phase 1 : en-têtes uniquement (sanitisation + limites) ----------
  let fileCount = 0;
  let totalSize = 0;
  /** @type {{path: string, size: number}[]} fichiers qui seront écrits */
  const entries = [];

  let list;
  try {
    list = extractor.getFileList();
    if (list.arcHeader?.flags?.volume) fail("VOLUME");
    for (const h of list.fileHeaders) {
      if (h.flags?.encrypted) fail("ENCRYPTED");
      if (h.flags?.directory) continue;

      const s = sanitizeEntryPath(h.name, limits);
      if (!s.ok) {
        if (
          s.reason === "traversal" ||
          s.reason === "absolute" ||
          s.reason === "invalid"
        ) {
          ignored.outside++;
          fail("UNSAFE_PATHS"); // politique stricte : archive refusée
        }
        fail("PATH_LIMITS");
      }
      if (isSystemNoise(s.path)) {
        ignored.systemFiles++;
        continue;
      }
      if (hasGitSegment(s.path)) {
        ignored.gitDirs++;
        continue;
      }
      const size = Number(h.unpSize ?? 0);
      fileCount++;
      totalSize += size;
      if (fileCount > maxFiles) fail("TOO_MANY_FILES");
      if (totalSize > maxExtractBytes) fail("TOO_BIG");
      entries.push({ path: s.path, size });
    }
  } catch (e) {
    mapUnrarError(e);
  }

  if (fileCount === 0) fail("EMPTY");

  // --- Contrôle structurel (motif d'attaque symlink traversal) : une entrée
  // ne peut pas être à la fois un fichier et un ancêtre d'un autre chemin.
  // (Ici 'up' est un symlink → on le matérialisera en fichier régulier, et
  // 'up/...' planterait ; plutôt : on refuse l'archive entière.)
  const fileSet = new Set(entries.map((e) => e.path));
  for (const e of entries) {
    const parts = e.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (fileSet.has(parts.slice(0, i).join("/"))) {
        ignored.outside++;
        fail("UNSAFE_PATHS");
      }
    }
  }

  // ---------- Phase 2 : extraction réelle (écriture contrôlée) ----------
  fs.mkdirSync(destDir, { recursive: true });
  let extracted;
  try {
    extracted = extractor.extract();
    for (const f of extracted.files) {
      const h = f.fileHeader;
      if (h.flags?.directory) continue;

      const s = sanitizeEntryPath(h.name, limits);
      if (!s.ok) fail("UNSAFE_PATHS");
      if (isSystemNoise(s.path) || hasGitSegment(s.path)) continue;

      const abs = path.join(destDir, s.path);
      // Garde supplémentaire : le chemin résolu doit rester dans destDir.
      if (!abs.startsWith(destDir + path.sep)) fail("UNSAFE_PATHS");

      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (f.extraction) fs.writeFileSync(abs, f.extraction, { mode: 0o644 });
    }
  } catch (e) {
    mapUnrarError(e);
  }

  return { ok: true, fileCount, totalSize, entries, ignored };
}

main()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  })
  .catch((e) => {
    const payload = {
      ok: false,
      code: e instanceof Fail ? e.code : "CORRUPT",
      detail: e instanceof Fail ? String(e.detail ?? "") : String(e?.message ?? e),
    };
    process.stdout.write(JSON.stringify(payload));
    process.exit(1);
  });
