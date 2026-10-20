/**
 * Extraction .tar (et .tar.gz / .tgz) — lecteur d'archives POSIX « ustar »,
 * GNU tar et PAX écrit à la main.
 *
 * Pourquoi à la main ?
 *  - aucune dépendance native ni binaire externe (le conteneur n'a pas besoin
 *    de `tar`, `libarchive`, …) ;
 *  - lecture en streaming : l'archive n'est JAMAIS chargée entièrement en
 *    mémoire, seul un tampon de blocs de 512 octets circule ;
 *  - mêmes garde-fous que .zip/.rar : sanitisation des chemins, limites
 *    cumulées AVANT écriture (anti-bombe), symlinks/hardlinks écartés,
 *    `.git` et bruit système ignorés, conflits fichier/ancêtre refusés.
 *
 * Formats gérés : ustar (POSIX.1-1988), GNU tar (noms longs `L`, liens longs
 * `K`), PAX (`x` étendu, `g` global), gzip (`.tar.gz` / `.tgz`).
 * Refusés : archives chiffrées (ça n'existe pas en tar), volumes GNU (`D`).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { once, type Readable } from "node:stream";
import { AppError } from "../errors";
import {
  sanitizeEntryPath,
  isSystemNoise,
  hasGitSegment,
} from "../sanitize.mjs";
import { emptyIgnored, type ExtractLimits, type ExtractResult } from "./types";

const BLOCK = 512;
const TIMEOUT_MS = 180_000;

/* ------------------------------------------------------------------ flux */

/**
 * Découpe un flux d'octets en blocs de 512 octets (le format tar est un
 * empilement de blocs fixes). `null` = fin de flux.
 */
class BlockReader {
  private rest: Buffer = Buffer.alloc(0);
  private iter: AsyncIterator<Buffer>;
  private ended = false;

  constructor(source: Readable) {
    this.iter = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  async next(): Promise<Buffer | null> {
    while (this.rest.length < BLOCK) {
      if (this.ended) return null;
      const r = await this.iter.next();
      if (r.done) {
        this.ended = true;
        continue;
      }
      const chunk = r.value;
      this.rest =
        this.rest.length === 0 ? chunk : Buffer.concat([this.rest, chunk]);
    }
    const block = this.rest.subarray(0, BLOCK);
    this.rest = this.rest.subarray(BLOCK);
    return block;
  }

  /** Libère le flux sous-jacent (erreur, timeout). */
  async close(): Promise<void> {
    try {
      await this.iter.return?.();
    } catch {
      /* ignore */
    }
  }
}

/** `true` si le flux est gzipé (magic 1f 8b). */
function isGzip(filePath: string): boolean {
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(2);
    const n = fs.readSync(fd, head, 0, 2, 0);
    return n === 2 && head[0] === 0x1f && head[1] === 0x8b;
  } finally {
    fs.closeSync(fd);
  }
}

/* --------------------------------------------------------------- en-têtes */

/** Nombre octal d'un champ tar (ou base-256 GNU pour les valeurs géantes). */
function parseNumeric(buf: Buffer): number {
  if (buf.length === 0) return 0;
  // Encodage base-256 GNU : bit de poids fort à 1, 0xff = négatif.
  if ((buf[0] & 0x80) !== 0) {
    const negative = buf[0] === 0xff;
    let v = 0;
    for (let i = 1; i < buf.length; i++) v = v * 256 + buf[i];
    return negative ? -v : v;
  }
  const s = buf.toString("latin1").replace(/\0[\s\S]*$/, "").trim();
  if (s === "") return 0;
  if (!/^[0-7]+$/.test(s)) return NaN;
  return Number.parseInt(s, 8);
}

/** Chaîne C d'un champ (terminée par NUL). */
function parseString(buf: Buffer): string {
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString("utf8");
}

function isZeroBlock(b: Buffer): boolean {
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
  return true;
}

/**
 * Vérifie la somme de contrôle de l'en-tête (le champ chksum est traité comme
 * 8 espaces). Certaines implémentations écrivent une somme signée : on accepte
 * les deux. Une somme fausse = archive corrompue/tronquée.
 */
function checksumValid(block: Buffer): boolean {
  const declared = parseNumeric(block.subarray(148, 156));
  if (!Number.isFinite(declared)) return false;
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const byte = i >= 148 && i < 156 ? 0x20 : block[i];
    unsigned += byte;
    signed += byte < 128 ? byte : byte - 256;
  }
  return declared === unsigned || declared === signed;
}

interface TarHeader {
  name: string;
  size: number;
  /** Caractère du typeflag ("" pour le type 0 historique). */
  typeflag: string;
  linkname: string;
  /** Bits d'exécution (0o111) → 0o755, sinon 0o644. */
  mode: number;
}

function parseHeader(block: Buffer): TarHeader | null {
  const magic = block.subarray(257, 263).toString("latin1");
  const isUstar = magic.startsWith("ustar");
  const name = parseString(block.subarray(0, 100));
  const prefix = isUstar ? parseString(block.subarray(345, 500)) : "";
  const size = parseNumeric(block.subarray(124, 136));
  const rawMode = parseNumeric(block.subarray(100, 108));
  const typeByte = block[156];
  const typeflag = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size: Number.isFinite(size) ? size : NaN,
    typeflag,
    linkname: parseString(block.subarray(157, 257)),
    mode: Number.isFinite(rawMode) ? rawMode : 0o644,
  };
}

/** Enregistrements PAX : `<len> <clé>=<valeur>\n` (longueurs en OCTETS). */
export function parsePaxRecords(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let pos = 0;
  while (pos < data.length) {
    const sp = data.indexOf(0x20, pos);
    if (sp < 0) break;
    const len = Number.parseInt(data.subarray(pos, sp).toString("latin1"), 10);
    if (!Number.isFinite(len) || len <= 0 || pos + len > data.length) break;
    // On retire le "\n" final de l'enregistrement.
    const body = data.subarray(sp + 1, pos + len - 1);
    const eq = body.indexOf(0x3d);
    if (eq > 0) {
      out.set(
        body.subarray(0, eq).toString("utf8"),
        body.subarray(eq + 1).toString("utf8"),
      );
    }
    pos += len;
  }
  return out;
}

/* ---------------------------------------------------------------- écriture */

/** Écrit exactement `size` octets (les blocs sont arrondis à 512). */
async function writeBlocks(
  reader: BlockReader,
  absPath: string,
  size: number,
  mode: number,
  deadline: number,
): Promise<number> {
  const ws = fs.createWriteStream(absPath, { flags: "w", mode });
  let written = 0;
  try {
    let remaining = size;
    while (remaining > 0) {
      if (Date.now() > deadline) throw new AppError("TIMEOUT");
      const block = await reader.next();
      if (!block) throw new AppError("CORRUPT", undefined, "archive tronquée");
      const take = Math.min(remaining, BLOCK);
      const part = block.subarray(0, take);
      remaining -= take;
      written += take;
      // Le bourrage du dernier bloc partiel est DANS ce bloc (512 o fixes) :
      // il ne faut surtout pas lire un bloc de plus, ce serait l'en-tête
      // de l'entrée suivante.
      if (!ws.write(part)) await once(ws, "drain");
    }
  } finally {
    await new Promise<void>((resolve) => ws.end(() => resolve()));
  }
  return written;
}

/** Consomme (sans écrire) les blocs de données d'une entrée. */
async function skipBlocks(reader: BlockReader, size: number): Promise<void> {
  const blocks = Math.ceil(Math.max(0, size) / BLOCK);
  for (let i = 0; i < blocks; i++) {
    const block = await reader.next();
    if (!block) throw new AppError("CORRUPT", undefined, "archive tronquée");
  }
}

/* ------------------------------------------------------------- extraction */

export async function extractTar(
  archivePath: string,
  destDir: string,
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const ignored = emptyIgnored();
  const entries: { path: string; size: number }[] = [];
  const seenFiles = new Set<string>();
  const deadline = Date.now() + TIMEOUT_MS;

  let fileCount = 0;
  let totalSize = 0;
  let zeroBlocks = 0;

  // --- flux source : gunzip si nécessaire ---
  const raw: Readable = fs.createReadStream(archivePath, {
    highWaterMark: 64 * 1024,
  });
  let source: Readable = raw;
  if (isGzip(archivePath)) {
    const gunzip = zlib.createGunzip();
    // Une erreur de décompression doit remonter comme « archive corrompue ».
    gunzip.on("error", () => raw.destroy());
    source = raw.pipe(gunzip);
  }
  source.on("error", (e: Error) => {
    if (/incorrect (header|data) check|invalid stored block|unknown compression|too many length/i.test(e.message)) {
      raw.destroy();
    }
  });

  const reader = new BlockReader(source);

  /** Nom long GNU (`L`) / lien long GNU (`K`) en attente pour l'en-tête suivant. */
  let gnuLongName: string | null = null;
  let gnuLongLink: string | null = null;
  /** En-tête PAX étendu (`x`) en attente. */
  let paxNext: Map<string, string> | null = null;

  try {
    for (;;) {
      if (Date.now() > deadline) throw new AppError("TIMEOUT");
      const block = await reader.next();
      if (!block) break;

      if (isZeroBlock(block)) {
        zeroBlocks++;
        if (zeroBlocks >= 2) break; // marqueur de fin d'archive
        continue;
      }
      zeroBlocks = 0;

      if (!checksumValid(block)) {
        throw new AppError("CORRUPT", undefined, "somme de contrôle invalide");
      }
      const header = parseHeader(block);
      if (!header) throw new AppError("CORRUPT");
      if (!Number.isFinite(header.size) || header.size < 0) {
        throw new AppError("CORRUPT", undefined, "taille d'entrée invalide");
      }

      const type = header.typeflag;

      // ---------------------------------------------------------- méta-entrées
      if (type === "L" || type === "K") {
        // Nom / lien long GNU : le bloc de données contient le vrai chemin.
        const chunks: Buffer[] = [];
        let left = header.size;
        while (left > 0) {
          const b = await reader.next();
          if (!b) throw new AppError("CORRUPT", undefined, "archive tronquée");
          chunks.push(b.subarray(0, Math.min(left, BLOCK)));
          left -= BLOCK;
        }
        const value = Buffer.concat(chunks).toString("utf8").replace(/\0+$/, "");
        if (type === "L") gnuLongName = value;
        else gnuLongLink = value;
        continue;
      }

      if (type === "x" || type === "X") {
        const chunks: Buffer[] = [];
        let left = header.size;
        while (left > 0) {
          const b = await reader.next();
          if (!b) throw new AppError("CORRUPT", undefined, "archive tronquée");
          chunks.push(b.subarray(0, Math.min(left, BLOCK)));
          left -= BLOCK;
        }
        paxNext = parsePaxRecords(Buffer.concat(chunks));
        continue;
      }

      if (type === "g") {
        // PAX global : consommé et ignoré (commentaires, schily.*).
        await skipBlocks(reader, header.size);
        continue;
      }

      if (type === "V" || type === "M") {
        // Étiquette de volume / continuation GNU multi-volume.
        throw new AppError("VOLUME");
      }

      // ------------------------------------------------------- chemin effectif
      const rawName = gnuLongName ?? paxNext?.get("path") ?? header.name;
      const linkName = gnuLongLink ?? paxNext?.get("linkpath") ?? header.linkname;
      gnuLongName = null;
      gnuLongLink = null;
      paxNext = null;

      const isDirEntry = type === "5" || rawName.endsWith("/");

      // Dossiers : rien à écrire (git ne suit pas les dossiers vides).
      if (isDirEntry) {
        await skipBlocks(reader, header.size);
        continue;
      }

      // Liens : jamais recréés (même politique que zip/rar).
      if (type === "2") {
        ignored.symlinks++;
        void linkName;
        await skipBlocks(reader, header.size);
        continue;
      }
      if (type === "1") {
        ignored.hardlinks = (ignored.hardlinks ?? 0) + 1;
        await skipBlocks(reader, header.size);
        continue;
      }
      // Périphériques caractère/bloc, FIFO : bruit non versionnable.
      if (type === "3" || type === "4" || type === "6") {
        ignored.systemFiles++;
        await skipBlocks(reader, header.size);
        continue;
      }
      if (type !== "0" && type !== "7") {
        // Type inconnu : on ignore l'entrée sans casser l'extraction.
        await skipBlocks(reader, header.size);
        continue;
      }

      // --------------------------------------------------------- sanitisation
      const s = sanitizeEntryPath(rawName, limits);
      if (!s.ok) {
        if (
          s.reason === "traversal" ||
          s.reason === "absolute" ||
          s.reason === "invalid"
        ) {
          ignored.outside++;
          throw new AppError("UNSAFE_PATHS");
        }
        throw new AppError("PATH_LIMITS");
      }
      if (s.isDir) {
        await skipBlocks(reader, header.size);
        continue;
      }

      if (isSystemNoise(s.path)) {
        ignored.systemFiles++;
        await skipBlocks(reader, header.size);
        continue;
      }
      if (hasGitSegment(s.path)) {
        ignored.gitDirs++;
        await skipBlocks(reader, header.size);
        continue;
      }

      // --------------------------------------- limites cumulées AVANT écriture
      fileCount++;
      totalSize += header.size;
      if (fileCount > limits.maxFiles) throw new AppError("TOO_MANY_FILES");
      if (totalSize > limits.maxExtractBytes) throw new AppError("TOO_BIG");

      // Conflit structurel : un ancêtre est déjà un fichier écrit.
      const segs = s.path.split("/");
      for (let i = 1; i < segs.length; i++) {
        if (seenFiles.has(segs.slice(0, i).join("/"))) {
          ignored.outside++;
          throw new AppError("UNSAFE_PATHS");
        }
      }

      // -------------------------------------------------------------- écriture
      const abs = path.join(destDir, s.path);
      const mode = (header.mode & 0o111) !== 0 ? 0o755 : 0o644;
      try {
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        const written = await writeBlocks(reader, abs, header.size, mode, deadline);
        if (written !== header.size) {
          throw new AppError("CORRUPT", undefined, "taille écrite incohérente");
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === "EEXIST" || code === "ENOTDIR") {
          ignored.outside++;
          throw new AppError("UNSAFE_PATHS");
        }
        if (code === "ERR_STREAM_PREMATURE_CLOSE" || /gunzip|inflate/i.test(String((e as Error)?.message))) {
          throw new AppError("CORRUPT", undefined, "flux gzip interrompu");
        }
        throw new AppError("CORRUPT", undefined, String((e as Error)?.message ?? e));
      }
      seenFiles.add(s.path);
      entries.push({ path: s.path, size: header.size });
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/incorrect (header|data) check|invalid (stored|code lengths|distance)|unexpected end of file/i.test(msg)) {
      throw new AppError("CORRUPT", undefined, "flux gzip invalide");
    }
    throw new AppError("CORRUPT", undefined, msg);
  } finally {
    await reader.close();
    raw.destroy();
  }

  if (fileCount === 0) throw new AppError("EMPTY");

  return { fileCount, totalSize, entries, ignored };
}
