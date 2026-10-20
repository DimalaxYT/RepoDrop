/**
 * Tests d'extraction .tar / .tar.gz.
 *
 * Deux familles de fixtures :
 *  - des archives RÉELLES produites par le `tar` du système (GNU tar), pour
 *    valider les formats courants (ustar, GNU longname, PAX, gzip, liens) ;
 *  - des archives HOSTILES construites octet par octet (traversal, absolu,
 *    bombe, somme de contrôle fausse, troncature).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractTar } from "@/lib/extract/tar";
import { parsePaxRecords } from "@/lib/extract/tar";
import { buildPreview } from "@/lib/extract/preview";
import { AppError } from "@/lib/errors";
import type { ExtractLimits } from "@/lib/extract/types";

const LIMITS: ExtractLimits = {
  maxExtractBytes: 20 * 1024 * 1024,
  maxFiles: 1000,
  maxDepth: 16,
  maxPathLength: 500,
};

let tmp: string;
let n = 0;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rd-tar-"));
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

/** Crée une arborescence source puis l'archive avec le tar du système. */
function makeSource(files: Record<string, string>): string {
  const src = path.join(tmp, `src-${n++}`);
  fs.mkdirSync(src, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return src;
}

interface TarOpts {
  gzip?: boolean;
  format?: "gnu" | "pax" | "ustar" | "v7";
  args?: string[];
}

/** Archive un dossier source avec GNU tar et renvoie le chemin du .tar[.gz]. */
function makeTar(srcDir: string, opts: TarOpts = {}): string {
  const file = path.join(tmp, `a-${n++}${opts.gzip ? ".tar.gz" : ".tar"}`);
  const args = ["-cf", file];
  if (opts.gzip) args.push("-z");
  if (opts.format) args.push(`--format=${opts.format}`);
  if (opts.args) args.push(...opts.args);
  args.push("-C", srcDir, ".");
  execFileSync("tar", args);
  return file;
}

/** Extrait dans un dossier neuf et renvoie le résultat + ce dossier. */
async function extract(archive: string, limits: ExtractLimits = LIMITS) {
  const dest = path.join(tmp, `out-${n++}`);
  await fsp.mkdir(dest, { recursive: true });
  const res = await extractTar(archive, dest, limits);
  return { ...res, dest };
}

/* ------------------------------------------------------------------ nominal */

describe("extractTar — archives produites par GNU tar", () => {
  it("extrait une arborescence .tar complète (contenu et tailles)", async () => {
    const src = makeSource({
      "index.js": "console.log('bonjour')\n",
      "src/app.ts": "export const a = 1;\n",
      "src/lib/util.ts": "export const b = 2;\n",
      "docs/README.md": "# Titre\n",
    });
    const res = await extract(makeTar(src));

    expect(res.fileCount).toBe(4);
    expect(res.entries.map((e) => e.path).sort()).toEqual([
      "docs/README.md",
      "index.js",
      "src/app.ts",
      "src/lib/util.ts",
    ]);
    expect(res.totalSize).toBe(
      fs.statSync(path.join(res.dest, "src/app.ts")).size +
        fs.statSync(path.join(res.dest, "index.js")).size +
        fs.statSync(path.join(res.dest, "src/lib/util.ts")).size +
        fs.statSync(path.join(res.dest, "docs/README.md")).size,
    );
    expect(
      fs.readFileSync(path.join(res.dest, "src/app.ts"), "utf8"),
    ).toBe("export const a = 1;\n");
  });

  it("extrait un .tar.gz (flux gunzip)", async () => {
    const src = makeSource({
      "a.txt": "A".repeat(5000),
      "nested/deep/b.txt": "B".repeat(7000),
    });
    const res = await extract(makeTar(src, { gzip: true }));

    expect(res.fileCount).toBe(2);
    expect(fs.readFileSync(path.join(res.dest, "nested/deep/b.txt"), "utf8")).toBe(
      "B".repeat(7000),
    );
  });

  it("conserve les noms longs au format GNU (enregistrements 'L')", async () => {
    const long = "d".repeat(120);
    const src = makeSource({ [`${long}/fichier-tres-profond.txt`]: "ok\n" });
    const res = await extract(makeTar(src, { format: "gnu" }));

    expect(res.fileCount).toBe(1);
    expect(res.entries[0].path).toBe(`${long}/fichier-tres-profond.txt`);
  });

  it("conserve les noms longs au format PAX (enregistrements 'x')", async () => {
    const long = "p".repeat(110);
    const src = makeSource({ [`${long}/nom-de-fichier-interminable.txt`]: "pax\n" });
    const res = await extract(makeTar(src, { format: "pax" }));

    expect(res.fileCount).toBe(1);
    expect(res.entries[0].path).toBe(`${long}/nom-de-fichier-interminable.txt`);
    expect(
      fs.readFileSync(
        path.join(res.dest, long, "nom-de-fichier-interminable.txt"),
        "utf8",
      ),
    ).toBe("pax\n");
  });

  it("écarte les symlinks sans jamais les créer", async () => {
    const src = makeSource({ "vrai.txt": "contenu\n" });
    fs.symlinkSync("vrai.txt", path.join(src, "lien.txt"));
    const res = await extract(makeTar(src));

    expect(res.fileCount).toBe(1);
    expect(res.ignored.symlinks).toBe(1);
    expect(fs.existsSync(path.join(res.dest, "lien.txt"))).toBe(false);
  });

  it("écarte les hardlinks (comptés séparément des symlinks)", async () => {
    const src = makeSource({ "vrai.txt": "contenu\n" });
    fs.linkSync(path.join(src, "vrai.txt"), path.join(src, "double.txt"));
    const res = await extract(makeTar(src));

    expect(res.fileCount).toBe(1);
    expect(res.ignored.hardlinks).toBe(1);
    // tar archive la 1re occurrence en fichier et la 2e en hardlink, dans
    // l'ordre de readdir (non déterministe) : un seul des deux noms subsiste.
    const written = fs.readdirSync(res.dest);
    expect(written).toHaveLength(1);
    expect(["vrai.txt", "double.txt"]).toContain(written[0]);
    expect(fs.readFileSync(path.join(res.dest, written[0]), "utf8")).toBe("contenu\n");
  });

  it("ignore .git et le bruit système", async () => {
    const src = makeSource({
      "code.txt": "x\n",
      ".git/config": "[core]\n",
      ".git/objects/aa/bb": "blob\n",
      ".DS_Store": "junk",
    });
    const res = await extract(makeTar(src));

    expect(res.fileCount).toBe(1);
    expect(res.ignored.gitDirs).toBe(2);
    expect(res.ignored.systemFiles).toBe(1);
    expect(fs.existsSync(path.join(res.dest, ".git"))).toBe(false);
  });

  it("préserve le bit exécutable des scripts", async () => {
    const src = makeSource({ "run.sh": "#!/bin/sh\necho ok\n" });
    fs.chmodSync(path.join(src, "run.sh"), 0o755);
    const res = await extract(makeTar(src));

    const mode = fs.statSync(path.join(res.dest, "run.sh")).mode & 0o777;
    expect(mode).toBe(0o755);
    expect(res.entries[0].size).toBeGreaterThan(0);
  });

  it("produit un aperçu cohérent (dossier racine unique détecté)", async () => {
    const src = makeSource({
      "mon-projet/index.js": "1\n",
      "mon-projet/src/a.js": "2\n",
    });
    const res = await extract(makeTar(src));
    const preview = buildPreview(res);

    expect(preview.singleRootDir).toBe("mon-projet");
    expect(preview.fileCount).toBe(2);
    expect(preview.tree.map((t) => t.path)).toEqual([
      "mon-projet/",
      "mon-projet/src/",
      "mon-projet/src/a.js",
      "mon-projet/index.js",
    ]);
  });
});

/* ------------------------------------------------------------------ limites */

describe("extractTar — limites et garde-fous", () => {
  it("refuse une archive sans aucun fichier exploitable", async () => {
    const src = makeSource({ ".git/config": "[core]\n" });
    await expect(extract(makeTar(src))).rejects.toMatchObject({ code: "EMPTY" });
  });

  it("applique MAX_FILES", async () => {
    const src = makeSource({ "a.txt": "1\n", "b.txt": "2\n", "c.txt": "3\n" });
    await expect(
      extract(makeTar(src), { ...LIMITS, maxFiles: 2 }),
    ).rejects.toMatchObject({ code: "TOO_MANY_FILES" });
  });

  it("applique MAX_EXTRACT_MB sur les tailles déclarées", async () => {
    const src = makeSource({ "gros.txt": "x".repeat(50_000) });
    await expect(
      extract(makeTar(src), { ...LIMITS, maxExtractBytes: 10_000 }),
    ).rejects.toMatchObject({ code: "TOO_BIG" });
  });

  it("refuse une profondeur excessive", async () => {
    const deep = Array.from({ length: 8 }, (_, i) => `d${i}`).join("/") + "/f.txt";
    const src = makeSource({ [deep]: "x\n" });
    await expect(
      extract(makeTar(src), { ...LIMITS, maxDepth: 4 }),
    ).rejects.toMatchObject({ code: "PATH_LIMITS" });
  });
});

/* ----------------------------------------------------- archives hostiles */

/** Écrit un en-tête ustar de 512 octets (somme de contrôle valide). */
function tarHeader(opts: {
  name: string;
  size: number;
  typeflag?: string;
  prefix?: string;
  linkname?: string;
  corruptChecksum?: boolean;
}): Buffer {
  const b = Buffer.alloc(512);
  b.write(opts.name.slice(0, 100), 0, 100, "utf8");
  b.write("0000644\0", 100, 8, "latin1");
  b.write("0000000\0", 108, 8, "latin1");
  b.write("0000000\0", 116, 8, "latin1");
  b.write(opts.size.toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
  b.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12, "latin1");
  b.write("        ", 148, 8, "latin1");
  b.write(opts.typeflag ?? "0", 156, 1, "latin1");
  if (opts.linkname) b.write(opts.linkname.slice(0, 100), 157, 100, "utf8");
  b.write("ustar\0", 257, 6, "latin1");
  b.write("00", 263, 2, "latin1");
  if (opts.prefix) b.write(opts.prefix.slice(0, 155), 345, 155, "utf8");

  let sum = 0;
  for (const byte of b) sum += byte;
  if (opts.corruptChecksum) sum += 7;
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
  return b;
}

function dataBlock(content: string): Buffer {
  const size = Buffer.byteLength(content);
  const buf = Buffer.alloc(Math.ceil(size / 512) * 512);
  buf.write(content, 0, size, "utf8");
  return buf;
}

function writeRawTar(parts: Buffer[]): string {
  const file = path.join(tmp, `raw-${n++}.tar`);
  fs.writeFileSync(file, Buffer.concat([...parts, Buffer.alloc(1024)]));
  return file;
}

describe("extractTar — archives hostiles", () => {
  it("refuse un chemin en traversal (../)", async () => {
    const archive = writeRawTar([tarHeader({ name: "../echappe.txt", size: 4 }), dataBlock("pwn\n")]);
    await expect(extract(archive)).rejects.toMatchObject({ code: "UNSAFE_PATHS" });
  });

  it("refuse un chemin absolu", async () => {
    const archive = writeRawTar([tarHeader({ name: "/tmp/echappe.txt", size: 4 }), dataBlock("pwn\n")]);
    await expect(extract(archive)).rejects.toMatchObject({ code: "UNSAFE_PATHS" });
  });

  it("refuse une bombe (taille déclarée démesurée)", async () => {
    const archive = writeRawTar([
      tarHeader({ name: "bombe.bin", size: 2 * 1024 * 1024 * 1024 }),
    ]);
    await expect(extract(archive)).rejects.toMatchObject({ code: "TOO_BIG" });
  });

  it("détecte une somme de contrôle invalide", async () => {
    const archive = writeRawTar([
      tarHeader({ name: "a.txt", size: 4, corruptChecksum: true }),
      dataBlock("aaaa"),
    ]);
    await expect(extract(archive)).rejects.toBeInstanceOf(AppError);
    await expect(extract(archive)).rejects.toMatchObject({ code: "CORRUPT" });
  });

  it("détecte une archive tronquée (données manquantes)", async () => {
    const file = path.join(tmp, `trunc-${n++}.tar`);
    fs.writeFileSync(file, tarHeader({ name: "a.txt", size: 5000 }));
    await expect(extract(file)).rejects.toMatchObject({ code: "CORRUPT" });
  });

  it("refuse le motif « fichier puis descendant »", async () => {
    const archive = writeRawTar([
      tarHeader({ name: "up", size: 4 }),
      dataBlock("aaaa"),
      tarHeader({ name: "up/child.txt", size: 4 }),
      dataBlock("bbbb"),
    ]);
    await expect(extract(archive)).rejects.toMatchObject({ code: "UNSAFE_PATHS" });
  });

  it("n'écrit jamais le second nom d'un hardlink, quel que soit l'ordre", async () => {
    // GNU tar archive la première occurrence en fichier régulier et la seconde
    // en hardlink, dans l'ordre (non déterministe) de readdir. Ici l'ordre est
    // imposé : le fichier d'abord, le hardlink ensuite.
    const archive = writeRawTar([
      tarHeader({ name: "garde.txt", size: 7 }),
      dataBlock("contenu"),
      tarHeader({ name: "double.txt", size: 0, typeflag: "1", linkname: "garde.txt" }),
    ]);
    const res = await extract(archive);

    expect(res.fileCount).toBe(1);
    expect(res.entries[0].path).toBe("garde.txt");
    expect(res.ignored.hardlinks).toBe(1);
    expect(fs.existsSync(path.join(res.dest, "double.txt"))).toBe(false);
  });

  it("ignore les périphériques et FIFO sans écrire de nœud spécial", async () => {
    const archive = writeRawTar([
      tarHeader({ name: "null", size: 0, typeflag: "3" }),
      tarHeader({ name: "pipe", size: 0, typeflag: "6" }),
      tarHeader({ name: "vrai.txt", size: 3 }),
      dataBlock("xyz"),
    ]);
    const res = await extract(archive);

    expect(res.fileCount).toBe(1);
    expect(res.ignored.systemFiles).toBe(2);
  });
});

/* ------------------------------------------------------------- utilitaires */

/** Construit un enregistrement PAX valide : « <len> clé=valeur\n ». */
function paxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`;
  let total = body.length + 2;
  for (let i = 0; i < 6; i++) {
    const next = body.length + 1 + String(total).length;
    if (next === total) break;
    total = next;
  }
  return `${total} ${body}`;
}

describe("parsePaxRecords", () => {
  it("décode les enregistrements clé=valeur", () => {
    const raw =
      paxRecord("path", "dossier/fichier-long.txt") + paxRecord("linkpath", "a.txt");
    const map = parsePaxRecords(Buffer.from(raw, "utf8"));
    expect(map.get("path")).toBe("dossier/fichier-long.txt");
    expect(map.get("linkpath")).toBe("a.txt");
  });

  it("tolère une fin d'enregistrement incohérente", () => {
    const map = parsePaxRecords(Buffer.from("99 path=tronque", "utf8"));
    expect(map.size).toBe(0);
  });
});
