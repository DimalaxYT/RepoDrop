/**
 * Détection de format + dispatch d'extraction.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors";
import type { ArchiveFormat } from "../types";
import { extractZip } from "./zip";
import { extractRar } from "./rar";
import type { ExtractLimits, ExtractResult } from "./types";

/** Détection par magic bytes (les extensions seuls ne suffisent pas). */
export function detectFormat(firstBytes: Buffer): ArchiveFormat | null {
  if (firstBytes.length >= 4) {
    // ZIP : PK\x03\x04 (vide : PK\x05\x06, segmenté : PK\x07\x08)
    if (
      firstBytes[0] === 0x50 &&
      firstBytes[1] === 0x4b &&
      (firstBytes[2] === 0x03 || firstBytes[2] === 0x05 || firstBytes[2] === 0x07)
    ) {
      return "zip";
    }
    // RAR4 : "Rar!\x1a\x07\x00" / RAR5 : "Rar!\x1a\x07\x01\x00"
    if (
      firstBytes[0] === 0x52 &&
      firstBytes[1] === 0x61 &&
      firstBytes[2] === 0x72 &&
      firstBytes[3] === 0x21 &&
      firstBytes[4] === 0x1a &&
      firstBytes[5] === 0x07
    ) {
      return "rar";
    }
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
  throw new AppError("UNSUPPORTED");
}
