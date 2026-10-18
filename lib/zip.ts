/**
 * Génération d'une archive .zip à partir d'un dossier extrait.
 *
 * Réutilise yazl (dépendance existante). La sécurité a été faite à
 * l'extraction (plus de symlink, plus de `.git`, pas de traversal) : on
 * reconstruit un zip propre (entrées propres, node_modules exclus).
 */
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { AppError } from "./errors";

interface FileEntry {
  /** Chemin relatif (séparateur /) dans l'archive. */
  entryPath: string;
  /** Chemin absolu sur le disque. */
  filePath: string;
}

/** Parcours récursif ; node_modules exclu du zip. */
async function* walk(dir: string, baseDir: string): AsyncGenerator<FileEntry> {
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    throw new AppError("INTERNAL");
  }
  for (const item of items) {
    const from = path.join(dir, item.name);
    const rel = path.relative(baseDir, from).split(path.sep).join("/");
    if (item.isDirectory()) {
      yield { entryPath: `${rel}/`, filePath: from };
    } else if (item.isFile()) {
      yield { entryPath: rel, filePath: from };
    }
  }
}

/** Assemble le zip (yazl v2 = writer) dans le fichier temporaire. */
async function buildJobZip(
  srcDir: string,
  includeNodeModules: boolean,
  outPath: string,
): Promise<void> {
  const entries: FileEntry[] = [];
  for await (const e of walk(srcDir, srcDir)) {
    entries.push(e);
  }
  if (entries.length === 0) throw new AppError("EMPTY");

  const yazl = await import("yazl");
  const zip = new yazl.ZipFile();

  const writeStream = createWriteStream(outPath);
  const fileFinished = new Promise<void>((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  for (const e of entries) {
    if (e.entryPath.endsWith("/")) continue; // dossiers : implicitement créés
    zip.addFile(e.filePath, e.entryPath, {
      mtime: new Date(),
      compress: true,
      mode: 0o644,
    });
  }
  zip.outputStream.pipe(writeStream);
  await zip.end();
  await fileFinished; // pipe() termine writeStream quand le flux s'éteint
}

async function jobTempDir(jobId: string): Promise<string> {
  const dir = path.join(tmpdir(), "repodrop-downloads", jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Nettoie un nom de fichier (aucun chemin, caractères sûrs). */
export function safeFileName(name: string, fallback = "archive"): string {
  const cleaned = name
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

/** Construit un zip et renvoie son chemin + nom propre à télécharger. */
export async function zipJob(
  jobId: string,
  srcDir: string,
  fileName: string,
  includeNodeModules: boolean,
): Promise<{ path: string; name: string }> {
  const dir = await jobTempDir(jobId);
  const outName = safeFileName(fileName.replace(/\.[^.]+$/, ""));
  const rand = randomBytes(8).toString("hex");
  const outPath = path.join(dir, `${outName}-${rand}.zip`);
  await buildJobZip(srcDir, includeNodeModules, outPath);
  return { path: outPath, name: outName };
}
