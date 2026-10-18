/**
 * Tests d'extraction .zip avec de vraies archives construites via yazl.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yazl from "yazl";
import { extractZip } from "@/lib/extract/zip";
import { buildPreview } from "@/lib/extract/preview";
import { AppError } from "@/lib/errors";
import type { ExtractLimits, ExtractResult } from "@/lib/extract/types";

const LIMITS: ExtractLimits = {
  maxExtractBytes: 50 * 1024 * 1024,
  maxFiles: 1000,
  maxDepth: 16,
  maxPathLength: 500,
};

let tmp: string;
let n = 0;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rd-zip-"));
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

/** Construit un .zip à partir de [chemin, contenu] (0 = dossier implicite via /). */
async function makeZip(
  files: { path: string; content: string | Buffer; mode?: number }[],
): Promise<string> {
  const file = path.join(tmp, `t-${n++}.zip`);
  const zf = new yazl.ZipFile();
  for (const f of files) {
    const buf = typeof f.content === "string" ? Buffer.from(f.content) : f.content;
    zf.addBuffer(buf, f.path, f.mode !== undefined ? { mode: f.mode } : {});
  }
  await new Promise<void>((resolve, reject) => {
    zf.outputStream
      .pipe(fs.createWriteStream(file))
      .on("close", () => resolve())
      .on("error", reject);
    zf.end();
  });
  return file;
}

/**
 * Zip « attaquant » : yazl refuse de créer des chemins malveillants, on
 * fabrique donc un zip valide avec un placeholder de MÊME LONGUEUR puis on
 * substitue les octets du nom (local header + central directory).
 */
async function makeEvilZip(placeholder: string, attackPath: string): Promise<string> {
  if (placeholder.length !== attackPath.length) {
    throw new Error("placeholder et attaque doivent avoir la même longueur");
  }
  const zip = await makeZip([
    { path: placeholder, content: "mal\n" },
    { path: "ok.txt", content: "bon\n" },
  ]);
  const raw = await fsp.readFile(zip);
  const patched = Buffer.from(
    raw.toString("latin1").replaceAll(placeholder, attackPath),
    "latin1",
  );
  const out = path.join(tmp, `evil-${n++}.zip`);
  await fsp.writeFile(out, patched);
  return out;
}

async function extractZipFile(zip: string): Promise<ExtractResult> {
  const dest = path.join(tmp, `out-${n++}`);
  await fsp.mkdir(dest, { recursive: true });
  return extractZip(zip, dest, LIMITS);
}

async function extractOf(files: Parameters<typeof makeZip>[0]) {
  const zip = await makeZip(files);
  const dest = path.join(tmp, `out-${n++}`);
  await fsp.mkdir(dest, { recursive: true });
  return extractZip(zip, dest, LIMITS);
}

describe("extractZip — cas nominal", () => {
  it("extrait des fichiers imbriqués et construit l'aperçu", async () => {
    const res = await extractOf([
      { path: "index.js", content: "console.log(1)\n" },
      { path: "src/app.ts", content: "export {}\n" },
      { path: "src/deep/util.ts", content: "export const x = 1\n" },
      { path: "README.md", content: "# Projet\n" },
    ]);
    expect(res.fileCount).toBe(4);
    expect(res.totalSize).toBeGreaterThan(0);
    expect(res.entries.map((e) => e.path).sort()).toEqual([
      "README.md",
      "index.js",
      "src/app.ts",
      "src/deep/util.ts",
    ]);

    const preview = buildPreview(res);
    expect(preview.singleRootDir).toBeNull();
    expect(preview.hasNodeModules).toBe(false);
    // l'arborescence contient les dossiers de niveau 1
    const paths = preview.tree.map((t) => t.path);
    expect(paths).toContain("src/");
    expect(paths).toContain("src/app.ts");
  });

  it("détecte le dossier racine unique", async () => {
    const res = await extractOf([
      { path: "mon-projet/package.json", content: "{}" },
      { path: "mon-projet/src/main.ts", content: "" },
    ]);
    const preview = buildPreview(res);
    expect(preview.singleRootDir).toBe("mon-projet");
    expect(preview.fileCount).toBe(2);
  });

  it("ne détecte pas de racine unique s'il y a un fichier à la racine", async () => {
    const res = await extractOf([
      { path: "racine.txt", content: "x" },
      { path: "dossier/a.txt", content: "y" },
    ]);
    expect(buildPreview(res).singleRootDir).toBeNull();
  });
});

describe("extractZip — sécurité", () => {
  it("refuse l'archive contenant un traversal ../", async () => {
    // « okfile.txt » (10) → « ../evil.sh » (10)
    const zip = await makeEvilZip("okfile.txt", "../evil.sh");
    await expect(extractZipFile(zip)).rejects.toMatchObject({
      code: "UNSAFE_PATHS",
    } satisfies Partial<AppError>);
  });

  it("refuse le traversal Windows en milieu de chemin", async () => {
    // « srcok_path.txt » (14) → « src\..\evil.sh » (14) — backslashes
    // convertis en « / » par yauzl avant validation.
    const zip = await makeEvilZip("srcok_path.txt", "src\\..\\evil.sh");
    await expect(extractZipFile(zip)).rejects.toMatchObject({
      code: "UNSAFE_PATHS",
    });
  });

  it("refuse les chemins absolus", async () => {
    // « file_etc.md » (11) → « /etc/passwd » (11)
    const zip = await makeEvilZip("file_etc.md", "/etc/passwd");
    await expect(extractZipFile(zip)).rejects.toMatchObject({
      code: "UNSAFE_PATHS",
    });
  });

  it("refuse le traversal profond avec plusieurs ..", async () => {
    // « deepfile_1 » (10) → « ../../evil » (10)
    const zip = await makeEvilZip("deepfile_1", "../../evil");
    await expect(extractZipFile(zip)).rejects.toMatchObject({
      code: "UNSAFE_PATHS",
    });
  });

  it("ignore .DS_Store et les .git sans échouer", async () => {
    const res = await extractOf([
      { path: "index.ts", content: "export {}\n" },
      { path: ".DS_Store", content: "junk" },
      { path: ".git/config", content: "[core]" },
      { path: "src/.git/HEAD", content: "ref: refs/heads/main" },
    ]);
    expect(res.fileCount).toBe(1);
    expect(res.ignored.systemFiles).toBe(1);
    expect(res.ignored.gitDirs).toBe(2);
    expect(res.entries.map((e) => e.path)).toEqual(["index.ts"]);
  });

  it("détecte les symlinks (mode unix) et les écarte", async () => {
    const res = await extractOf([
      { path: "real.txt", content: "data" },
      // 0o120777 = S_IFLNK | 0777 → symlink dans les attributs externes
      { path: "link.txt", content: "real.txt", mode: 0o120777 },
    ]);
    expect(res.ignored.symlinks).toBe(1);
    expect(res.entries.map((e) => e.path)).toEqual(["real.txt"]);
  });

  it("extrait node_modules mais le signale dans l'aperçu", async () => {
    const res = await extractOf([
      { path: "package.json", content: "{}" },
      { path: "node_modules/react/index.js", content: "module.exports = {}" },
    ]);
    expect(res.fileCount).toBe(2);
    expect(buildPreview(res).hasNodeModules).toBe(true);
  });

  it("signale les fichiers > 100 Mo pour l'aperçu GitHub", async () => {
    const res = await extractOf([
      { path: "ok.txt", content: "x" },
      { path: "gros.bin", content: Buffer.alloc(10) }, // taille réelle minuscule…
    ]);
    // …on force la taille déclarée via buildPreview sur un résultat falsifié :
    res.entries.push({ path: "huge.bin", size: 150 * 1024 * 1024 });
    res.fileCount += 1;
    const p = buildPreview(res);
    expect(p.tooLargeForGitHub.count).toBe(1);
    expect(p.tooLargeForGitHub.examples[0]?.path).toBe("huge.bin");
  });
});

describe("extractZip — limites", () => {
  it("rejette au-delà du nombre max de fichiers", async () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `f${i}.txt`,
      content: "x",
    }));
    const zip = await makeZip(files);
    const dest = path.join(tmp, `out-limit-${n++}`);
    await fsp.mkdir(dest, { recursive: true });
    const small: ExtractLimits = { ...LIMITS, maxFiles: 10 };
    await expect(extractZip(zip, dest, small)).rejects.toMatchObject({
      code: "TOO_MANY_FILES",
    });
  });

  it("rejette au-delà du poids décompressé max (anti-bombe)", async () => {
    // 300 Ko déclarés pour 10 Ko de zip : limité à 100 Ko décompressé.
    const big = Buffer.alloc(300 * 1024, 0);
    const zip = await makeZip([{ path: "big.bin", content: big }]);
    const dest = path.join(tmp, `out-bomb-${n++}`);
    await fsp.mkdir(dest, { recursive: true });
    const small: ExtractLimits = { ...LIMITS, maxExtractBytes: 100 * 1024 };
    await expect(extractZip(zip, dest, small)).rejects.toMatchObject({
      code: "TOO_BIG",
    });
  });

  it("rejette une archive vide / sans fichier", async () => {
    const zip = await makeZip([]);
    const dest = path.join(tmp, `out-empty-${n++}`);
    await fsp.mkdir(dest, { recursive: true });
    await expect(extractZip(zip, dest, LIMITS)).rejects.toMatchObject({
      code: "EMPTY",
    });
  });

  it("rejette un fichier non-zip (corrompu)", async () => {
    const file = path.join(tmp, `fake-${n++}.zip`);
    await fsp.writeFile(file, Buffer.alloc(2048, 7));
    const dest = path.join(tmp, `out-fake-${n++}`);
    await fsp.mkdir(dest, { recursive: true });
    await expect(extractZip(file, dest, LIMITS)).rejects.toMatchObject({
      code: "CORRUPT",
    });
  });
});
