/**
 * Détection de format + dispatch d'extraction.
 *
 * La détection se fait sur les premiers octets du fichier (magic bytes) :
 * une extension ne prouve rien. Les `.tar.gz` demandent un coup d'œil dans le
 * flux décompressé (l'en-tête `ustar` est à l'octet 257, donc après le gunzip)
 * → `detectArchive()` pour ça ; `detectFormat()` reste synchrone pour les
 * formats reconnaissables sans décompression.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { AppError } from "../errors";
import type { ArchiveFormat } from "../types";
import { extractZip } from "./zip";
import { extractRar } from "./rar";
import { extractTar } from "./tar";
import type { ExtractLimits, ExtractResult } from "./types";

/** Nombre d'octets d'en-tête à lire pour une détection fiable (ustar @257). */
export const DETECT_HEAD_BYTES = 16 * 1024;

const TAR_MAGIC_OFFSET = 257;

function hasTarMagic(buf: Buffer): boolean {
  return (
    buf.length >= TAR_MAGIC_OFFSET + 5 &&
    buf[TAR_MAGIC_OFFSET] === 0x75 && // u
    buf[TAR_MAGIC_OFFSET + 1] === 0x73 && // s
    buf[TAR_MAGIC_OFFSET + 2] === 0x74 && // t
    buf[TAR_MAGIC_OFFSET + 3] === 0x61 && // a
    buf[TAR_MAGIC_OFFSET + 4] === 0x72 // r
  );
}

const TAR_EXT = /\.(tar|tar\.gz|tar\.z|tgz|tpz)$/i;
const GZ_EXT = /\.(gz|tgz|tpz)$/i;

/**
 * Détection synchrone à partir des premiers octets.
 *
 * @param head     au moins 8 octets ; 263+ octets pour reconnaître un `.tar`
 *                 non compressé (magic `ustar` à l'offset 257).
 * @param filename nom d'origine, utilisé uniquement en dernier recours pour
 *                 les `.tar` sans magic et les `.gz` non décompressables ici.
 */
export function detectFormat(head: Buffer, filename = ""): ArchiveFormat | null {
  if (head.length >= 4) {
    // ZIP : PK\x03\x04 (vide : PK\x05\x06, segmenté : PK\x07\x08)
    if (
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)
    ) {
      return "zip";
    }
    // RAR4 : "Rar!\x1a\x07\x00" / RAR5 : "Rar!\x1a\x07\x01\x00"
    if (
      head[0] === 0x52 &&
      head[1] === 0x61 &&
      head[2] === 0x72 &&
      head[3] === 0x21 &&
      head[4] === 0x1a &&
      head[5] === 0x07
    ) {
      return "rar";
    }
    // tar non compressé (POSIX ustar / GNU)
    if (hasTarMagic(head)) return "tar";
  }
  // .tar « old-style » (V7) : pas de magic, mais un nom qui ne ment pas.
  // L'extracteur valide la somme de contrôle de chaque en-tête : un fichier
  // qui n'est pas un tar échouera proprement en « archive corrompue ».
  if (/\.(tar)$/i.test(filename)) return "tar";
  return null;
}

/** Offset du flux deflate dans un en-tête gzip (ou -1). */
function gzipDataOffset(b: Buffer): number {
  if (b.length < 10 || b[0] !== 0x1f || b[1] !== 0x8b) return -1;
  let o = 10;
  const flg = b[3];
  if (flg & 0x04) {
    // FEXTRA
    if (b.length < o + 2) return -1;
    o += 2 + b.readUInt16LE(o);
  }
  if (flg & 0x08) {
    // FNAME
    while (o < b.length && b[o] !== 0) o++;
    o++;
  }
  if (flg & 0x10) {
    // FCOMMENT
    while (o < b.length && b[o] !== 0) o++;
    o++;
  }
  if (flg & 0x02) o += 2; // FHCRC
  return o <= b.length ? o : -1;
}

/**
 * Décompresse AU PLUS `want` octets d'un flux gzip éventuellement tronqué.
 * Retourne ce qui a pu être décodé (jamais d'exception) — suffisant pour
 * aller lire le magic `ustar` à l'offset 257.
 */
export function peekGunzip(head: Buffer, want = 1024): Promise<Buffer> {
  return new Promise<Buffer>((resolve) => {
    const off = gzipDataOffset(head);
    if (off < 0) {
      resolve(Buffer.alloc(0));
      return;
    }
    const infl = zlib.createInflateRaw({
      finishFlush: zlib.constants.Z_SYNC_FLUSH,
    });
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    };
    infl.on("data", (c: Buffer) => {
      chunks.push(c);
      total += c.length;
      if (total >= want) {
        try {
          infl.destroy();
        } catch {
          /* ignore */
        }
        finish();
      }
    });
    infl.on("error", finish);
    infl.on("end", finish);
    infl.on("close", finish);
    infl.end(head.subarray(off));
  });
}

/**
 * Détection complète (synchrone + gzip). À utiliser côté serveur, avec un
 * en-tête d'au moins `DETECT_HEAD_BYTES` octets.
 */
export async function detectArchive(
  head: Buffer,
  filename = "",
): Promise<ArchiveFormat | null> {
  const sync = detectFormat(head, filename);
  if (sync) return sync;

  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
    const peeked = await peekGunzip(head, 1024);
    if (hasTarMagic(peeked)) return "tar";
    // Trop petit pour trancher : on fait confiance à l'extension (.tar.gz/.tgz).
    if (GZ_EXT.test(filename) && TAR_EXT.test(filename)) return "tar";
    return null;
  }
  return null;
}

export async function extractArchive(
  jobDir: string,
  archivePath: string,
  format: ArchiveFormat,
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const destDir = path.join(jobDir, "extract");
  await fsp.mkdir(destDir, { recursive: true });

  if (format === "zip") return extractZip(archivePath, destDir, limits);
  if (format === "rar") return extractRar(archivePath, destDir, limits);
  if (format === "tar") return extractTar(archivePath, destDir, limits);
  throw new AppError("UNSUPPORTED");
}
