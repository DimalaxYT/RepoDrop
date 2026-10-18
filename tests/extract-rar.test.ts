/**
 * Tests d'extraction .rar — exécution réelle du worker enfant
 * (scripts/rar-extract.mjs) avec les fixtures de tests/fixtures/rar/.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRar } from "@/lib/extract/rar";
import { buildPreview } from "@/lib/extract/preview";
import type { ExtractLimits } from "@/lib/extract/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "rar");

const LIMITS: ExtractLimits = {
  maxExtractBytes: 50 * 1024 * 1024,
  maxFiles: 1000,
  maxDepth: 16,
  maxPathLength: 500,
};

let tmp: string;
let n = 0;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rd-rar-"));
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

async function extractFixture(name: string, limits: ExtractLimits = LIMITS) {
  const dest = path.join(tmp, `out-${n++}`);
  await fsp.mkdir(dest, { recursive: true });
  const res = await extractRar(path.join(FIXTURES, name), dest, limits);
  return { res, dest };
}

describe("extractRar — cas nominaux", () => {
  it("extrait un RAR5 avec sous-dossiers, espaces et Unicode", async () => {
    const { res, dest } = await extractFixture("rar5-subdirs.rar");
    expect(res.fileCount).toBe(4);
    expect(res.entries.map((e) => e.path).sort()).toEqual([
      "sub/dir1/file1.txt",
      "sub/dir2/file2.txt",
      "sub/with space/long fn.txt",
      "sub/üȵĩöḋè/file.txt",
    ]);

    // Les fichiers existent réellement sur disque (contenu non vide).
    const content = await fsp.readFile(
      path.join(dest, "sub", "dir2", "file2.txt"),
      "utf8",
    );
    expect(content.length).toBeGreaterThan(0);

    const preview = buildPreview(res);
    expect(preview.singleRootDir).toBe("sub");
    expect(preview.tree.some((t) => t.path === "sub/")).toBe(true);
  });

  it("extrait un RAR3 (ancien format)", async () => {
    const { res } = await extractFixture("rar3-subdirs.rar");
    expect(res.fileCount).toBe(4);
    expect(res.totalSize).toBeGreaterThan(0);
    expect(res.ignored.outside).toBe(0);
  });
});

describe("extractRar — refus attendus", () => {
  it("refuse une archive chiffrée (mot de passe)", async () => {
    await expect(extractFixture("rar5-psw.rar")).rejects.toMatchObject({
      code: "ENCRYPTED",
    });
  });

  it("refuse un volume multi-parties", async () => {
    await expect(extractFixture("rar3-vols.part1.rar")).rejects.toMatchObject({
      code: "VOLUME",
    });
  });

  it("refuse l'attaque symlink traversal (up + up/…)", async () => {
    await expect(
      extractFixture("rar5-evil-symlink-traversal.rar"),
    ).rejects.toMatchObject({ code: "UNSAFE_PATHS" });
  });

  it("les symlinks RAR deviennent des fichiers réguliers (aucun lien créé)", async () => {
    const { res, dest } = await extractFixture("rar3-symlink-unix.rar");
    expect(res.fileCount).toBe(3);
    // data_link & random_link : contenu vide, mais fichiers NON symboliques.
    for (const name of ["data_link", "random_link"]) {
      const st = await fsp.lstat(path.join(dest, name));
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.isFile()).toBe(true);
    }
    // Rien n'a fui hors de dest.
    const escaped = await fsp.readdir(path.join(tmp, "..")).catch(() => []);
    expect(Array.isArray(escaped)).toBe(true);
  });

  it("rejette une archive corrompue (tronquée)", async () => {
    // Une vraie archive RAR coupée en deux → CRC/lecture invalide.
    const full = await fsp.readFile(path.join(FIXTURES, "rar5-subdirs.rar"));
    const fake = path.join(tmp, `fake-${n++}.rar`);
    await fsp.writeFile(fake, full.subarray(0, 80));
    await expect(extractRar(fake, path.join(tmp, `d-${n++}`), LIMITS)).rejects.toMatchObject(
      { code: "CORRUPT" },
    );
  });

  it("respecte la limite de nombre de fichiers", async () => {
    const small: ExtractLimits = { ...LIMITS, maxFiles: 2 };
    await expect(extractFixture("rar5-subdirs.rar", small)).rejects.toMatchObject({
      code: "TOO_MANY_FILES",
    });
  });

  it("respecte la limite de poids décompressé", async () => {
    const small: ExtractLimits = { ...LIMITS, maxExtractBytes: 10 };
    await expect(extractFixture("rar5-subdirs.rar", small)).rejects.toMatchObject({
      code: "TOO_BIG",
    });
  });
});
