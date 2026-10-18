import { describe, expect, it } from "vitest";
import {
  sanitizeEntryPath,
  isSystemNoise,
  hasGitSegment,
  hasNodeModulesSegment,
} from "@/lib/sanitize.mjs";

const LIMITS = { maxDepth: 8, maxPathLength: 100 };

describe("sanitizeEntryPath", () => {
  it("accepte les chemins normaux", () => {
    expect(sanitizeEntryPath("src/index.ts", LIMITS)).toEqual({
      ok: true,
      path: "src/index.ts",
      isDir: false,
    });
    expect(sanitizeEntryPath("src/deep/nested/file.js", LIMITS).ok).toBe(true);
  });

  it("normalise les répertoires avec trailing slash", () => {
    const r = sanitizeEntryPath("src/utils/", LIMITS);
    expect(r).toEqual({ ok: true, path: "src/utils/", isDir: true });
  });

  it("retire les ./ inoffensifs", () => {
    const r = sanitizeEntryPath("./src/./a.ts", LIMITS);
    expect(r.ok && r.path).toBe("src/a.ts");
  });

  it("rejette le traversal Unix", () => {
    expect(sanitizeEntryPath("../etc/passwd", LIMITS)).toMatchObject({
      ok: false,
      reason: "traversal",
    });
    expect(sanitizeEntryPath("src/../../etc/passwd", LIMITS)).toMatchObject({
      ok: false,
      reason: "traversal",
    });
    expect(sanitizeEntryPath("..", LIMITS)).toMatchObject({ ok: false });
  });

  it("rejette le traversal Windows (backslashes)", () => {
    expect(sanitizeEntryPath("..\\..\\evil.sh", LIMITS)).toMatchObject({
      ok: false,
      reason: "traversal",
    });
    expect(sanitizeEntryPath("src\\..\\..\\evil", LIMITS)).toMatchObject({
      ok: false,
      reason: "traversal",
    });
  });

  it("rejette les chemins absolus", () => {
    expect(sanitizeEntryPath("/etc/passwd", LIMITS)).toMatchObject({
      ok: false,
      reason: "absolute",
    });
    expect(sanitizeEntryPath("C:/Windows/system32", LIMITS)).toMatchObject({
      ok: false,
      reason: "absolute",
    });
    expect(sanitizeEntryPath("C:\\Users\\x", LIMITS)).toMatchObject({
      ok: false,
      reason: "absolute",
    });
    expect(sanitizeEntryPath("\\\\serveur\\partage", LIMITS)).toMatchObject({
      ok: false,
    });
  });

  it("rejette les caractères de contrôle et NUL", () => {
    expect(sanitizeEntryPath("src/a\u0000b.ts", LIMITS)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(sanitizeEntryPath("src/\u001fhidden", LIMITS)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejette les chemins trop longs ou trop profonds", () => {
    expect(sanitizeEntryPath("a".repeat(200), LIMITS)).toMatchObject({
      ok: false,
      reason: "too_long",
    });
    expect(sanitizeEntryPath("a/b/c/d/e/f/g/h/i/j", LIMITS)).toMatchObject({
      ok: false,
      reason: "too_deep",
    });
  });

  it("rejette les entrées vides et 'drive' en milieu de chemin", () => {
    expect(sanitizeEntryPath("", LIMITS)).toMatchObject({ ok: false });
    expect(sanitizeEntryPath("src/C:/x", LIMITS)).toMatchObject({ ok: false });
  });
});

describe("filtres de chemin", () => {
  it("détecte le bruit système", () => {
    expect(isSystemNoise("projet/.DS_Store")).toBe(true);
    expect(isSystemNoise("Thumbs.db")).toBe(true);
    expect(isSystemNoise("desktop.ini")).toBe(true);
    expect(isSystemNoise("src/index.ts")).toBe(false);
  });

  it("détecte les segments .git exacts (mais pas .gitignore)", () => {
    expect(hasGitSegment(".git/config")).toBe(true);
    expect(hasGitSegment("src/.git/HEAD")).toBe(true);
    expect(hasGitSegment(".gitignore")).toBe(false);
    expect(hasGitSegment("git/config")).toBe(false);
    expect(hasGitSegment(".gitlab-ci.yml")).toBe(false);
  });

  it("détecte node_modules", () => {
    expect(hasNodeModulesSegment("node_modules/react/index.js")).toBe(true);
    expect(hasNodeModulesSegment("packages/a/node_modules/x")).toBe(true);
    expect(hasNodeModulesSegment("src/nodes.ts")).toBe(false);
  });
});
