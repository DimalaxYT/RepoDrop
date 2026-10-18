/**
 * Extraction .zip — yauzl v3 (API `eachEntry` / `openReadStreamPromise`).
 *
 * Passage unique : chaque entrée est validée (sanitisation, limites, symlinks,
 * bruit système, `.git`) puis écrite. Les tailles déclarées du central
 * directory sont cumulées AVANT d'écrire l'entrée correspondante (défense
 * anti-bombe), et yauzl vérifie la cohérence taille déclarée/réelle pendant
 * le stream (`validateEntrySizes` par défaut).
 */
import { openPromise, type ZipFile } from "yauzl";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors";
import {
  sanitizeEntryPath,
  isSystemNoise,
  hasGitSegment,
} from "../sanitize.mjs";
import { emptyIgnored, type ExtractLimits, type ExtractResult } from "./types";

const SYMLINK_MASK = 0xa000;

/** Traduit les erreurs yauzl (validation de noms, I/O) en codes métier. */
function mapYauzlError(e: unknown): never {
  if (e instanceof AppError) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  // yauzl valide lui-même les noms (validateFileName) : traversal, absolu, NUL…
  if (
    /invalid relative path|absolute path|invalid character|NUL byte|filename/i.test(
      msg,
    )
  ) {
    throw new AppError("UNSAFE_PATHS", undefined, msg);
  }
  throw new AppError("CORRUPT", undefined, msg);
}

export async function extractZip(
  archivePath: string,
  destDir: string,
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const ignored = emptyIgnored();
  const entries: { path: string; size: number }[] = [];
  /** Fichiers déjà écrits (détection des conflits fichier/ancêtre). */
  const seenFiles = new Set<string>();
  let fileCount = 0;
  let totalSize = 0;

  // Objet de contexte : la reference reste bien typée dans les closures.
  const ctx: { zf: ZipFile | null } = { zf: null };
  const timeoutMs = 120_000;
  let timer: NodeJS.Timeout | undefined;

  const work = (async () => {
    ctx.zf = await openPromise(archivePath).catch((e) => {
      mapYauzlError(e);
    });
    const zipfile = ctx.zf;

    try {
      for await (const entry of zipfile.eachEntry()) {
        // --- chiffrement : non supporté ---
        if (entry.isEncrypted()) throw new AppError("ENCRYPTED");

        const isDirName = entry.fileName.endsWith("/");

        // --- sanitisation systématique ---
        const s = sanitizeEntryPath(entry.fileName, limits);
        if (!s.ok) {
          if (
            s.reason === "traversal" ||
            s.reason === "absolute" ||
            s.reason === "invalid"
          ) {
            ignored.outside++;
            // Politique stricte : toute tentative de traversal = archive refusée.
            throw new AppError("UNSAFE_PATHS");
          }
          throw new AppError("PATH_LIMITS");
        }

        // --- entrées de dossier : rien à écrire (git ne gère pas les dossiers vides) ---
        if (isDirName || s.isDir) continue;

        // --- méthodes de compression supportées (stored / deflate) ---
        if (!entry.canDecodeFileData()) throw new AppError("UNSUPPORTED");

        // --- symlink (mode unix dans externalFileAttributes) ---
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & SYMLINK_MASK) === SYMLINK_MASK) {
          ignored.symlinks++;
          continue;
        }

        // --- bruit système & .git : ignorés ---
        if (isSystemNoise(s.path)) {
          ignored.systemFiles++;
          continue;
        }
        if (hasGitSegment(s.path)) {
          ignored.gitDirs++;
          continue;
        }

      // --- limites cumulées AVANT écriture (anti-bombe) ---
      fileCount++;
      totalSize += entry.uncompressedSize;
      if (fileCount > limits.maxFiles) throw new AppError("TOO_MANY_FILES");
      if (totalSize > limits.maxExtractBytes) throw new AppError("TOO_BIG");

      // --- conflit structurel : un ancêtre est déjà un fichier (motif
      // d'attaque symlink traversal « up » + « up/x ») ---
      const segs = s.path.split("/");
      for (let i = 1; i < segs.length; i++) {
        if (seenFiles.has(segs.slice(0, i).join("/"))) {
          ignored.outside++;
          throw new AppError("UNSAFE_PATHS");
        }
      }

      // --- écriture ---
      const abs = path.join(destDir, s.path);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const readStream: Readable = await zipfile.openReadStreamPromise(entry);
      try {
        await pipeline(
          readStream,
          fs.createWriteStream(abs, {
            flags: "w",
            mode: (unixMode & 0o111) !== 0 ? 0o755 : 0o644,
          }),
        );
      } catch (e) {
        // Le chemin existe déjà comme RÉPERTOIRE (un enfant a été écrit
        // avant son ancêtre fichier) → conflit structurel, archive refusée.
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === "EEXIST" || code === "ENOTDIR") {
          ignored.outside++;
          throw new AppError("UNSAFE_PATHS");
        }
        throw e;
      }
      seenFiles.add(s.path);
      entries.push({ path: s.path, size: entry.uncompressedSize });
      }
    } catch (e) {
      mapYauzlError(e);
    }
  })();

  // Garde-fou : si le travail prend trop de temps, on ferme le fichier et
  // on rejette avec un message clair.
  work.catch(() => {}); // évite unhandled rejection si le timeout gagne
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        ctx.zf?.close();
      } catch {
        /* ignore */
      }
      reject(new AppError("TIMEOUT"));
    }, timeoutMs);
  });

  try {
    await Promise.race([work, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
    try {
      ctx.zf?.close();
    } catch {
      /* ignore */
    }
  }

  if (fileCount === 0) throw new AppError("EMPTY");

  return { fileCount, totalSize, entries, ignored };
}
