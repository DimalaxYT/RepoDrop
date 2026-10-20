/**
 * Détection de format par magic bytes — y compris le cas particulier des
 * `.tar.gz`, dont le magic `ustar` n'est visible qu'après décompression.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DETECT_HEAD_BYTES,
  detectArchive,
  detectFormat,
  peekGunzip,
} from "@/lib/extract";

let tmp: string;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rd-detect-"));
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

function makeArchive(name: string, files: Record<string, string>, gzip = false): string {
  const src = path.join(tmp, `${name}-src`);
  fs.mkdirSync(src, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const out = path.join(tmp, `${name}${gzip ? ".tar.gz" : ".tar"}`);
  const args = ["-cf", out];
  if (gzip) args.push("-z");
  args.push("-C", src, ".");
  execFileSync("tar", args);
  return out;
}

function head(file: string): Buffer {
  const buf = Buffer.alloc(DETECT_HEAD_BYTES);
  const fd = fs.openSync(file, "r");
  try {
    const n = fs.readSync(fd, buf, 0, DETECT_HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

describe("detectFormat (synchrone)", () => {
  it("reconnaît zip et rar sur 8 octets", () => {
    expect(detectFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBe("zip");
    expect(
      detectFormat(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])),
    ).toBe("rar");
  });

  it("reconnaît un .tar grâce au magic ustar à l'offset 257", () => {
    const h = head(makeArchive("plain", { "a.txt": "bonjour\n" }));
    expect(h.length).toBeGreaterThan(262);
    expect(detectFormat(h)).toBe("tar");
  });

  it("refuse ce qui n'est pas une archive", () => {
    expect(detectFormat(Buffer.from("MZ\x90\x00\x03"))).toBeNull();
    expect(detectFormat(Buffer.from("Ceci est un texte quelconque"))).toBeNull();
    expect(detectFormat(Buffer.alloc(0))).toBeNull();
  });

  it("accepte un .tar « old-style » (sans magic) sur la foi de son nom", () => {
    const faux = Buffer.alloc(512);
    expect(detectFormat(faux)).toBeNull();
    expect(detectFormat(faux, "archive.tar")).toBe("tar");
  });
});

describe("detectArchive (synchrone + gzip)", () => {
  it("reconnaît un .tar.gz sans extension explicite", async () => {
    const h = head(makeArchive("gz", { "src/index.js": "1\n" }, true));
    expect(await detectArchive(h)).toBe("tar");
  });

  it("reconnaît un .tgz même si l'en-tête décompressé est trop court", async () => {
    // 40 octets gzip : insuffisant pour atteindre l'offset 257 → on se rabat
    // sur l'extension.
    const h = head(makeArchive("tiny", { "a.txt": "x\n" }, true)).subarray(0, 40);
    expect(await detectArchive(h, "petit.tgz")).toBe("tar");
    expect(await detectArchive(h)).toBeNull();
  });

  it("ne confond pas un .zip avec un tar", async () => {
    const fakeZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(await detectArchive(fakeZip, "archive.zip")).toBe("zip");
    expect(await detectArchive(fakeZip, "archive.tar")).toBe("zip");
  });
});

describe("peekGunzip", () => {
  it("décode le début d'un flux gzip tronqué", async () => {
    const file = makeArchive("peek", { "dossier/fichier.txt": "contenu\n".repeat(200) }, true);
    const h = head(file);
    const decoded = await peekGunzip(h.subarray(0, 300), 1024);
    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded.subarray(257, 262).toString("latin1")).toBe("ustar");
  });

  it("renvoie un tampon vide si ce n'est pas du gzip", async () => {
    const decoded = await peekGunzip(Buffer.from("pas du gzip du tout"));
    expect(decoded.length).toBe(0);
  });
});
