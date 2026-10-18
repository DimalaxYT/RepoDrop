/**
 * Tests d'intégration du flux git complet contre un dépôt BARE local :
 * init → (fetch si existant) → overlay → commit → push. Pas de GitHub requis.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runGitPush } from "@/lib/git";

let tmp: string;

const run = (args: string[], cwd?: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rd-git-"));
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

/** Crée un dépôt bare distant, optionnellement avec un commit initial. */
function makeBare(name: string, withInitial: boolean): string {
  const bare = path.join(tmp, `${name}.git`);
  run(["init", "--bare", "-q", "-b", "main", bare]);
  if (withInitial) {
    const seed = path.join(tmp, `${name}-seed`);
    fs.mkdirSync(seed, { recursive: true });
    run(["init", "-q", "-b", "main", seed]);
    fs.writeFileSync(path.join(seed, "existing.txt"), "contenu existant\n");
    run(["-c", "user.name=seed", "-c", "user.email=seed@test", "add", "-A"], seed);
    run(["-c", "user.name=seed", "-c", "user.email=seed@test", "commit", "-q", "-m", "init"], seed);
    run(["remote", "add", "origin", bare], seed);
    run(["push", "-q", "origin", "main"], seed);
  }
  return bare;
}

/** Prépare un dossier job avec un src à pousser. */
function makeJob(name: string, files: Record<string, string>) {
  const jobDir = path.join(tmp, `${name}-job`);
  const srcDir = path.join(jobDir, "extract");
  fs.mkdirSync(srcDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(srcDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return { jobDir, srcDir };
}

describe("runGitPush — dépôt vierge (création)", () => {
  it("pushe une première fois sur un remote vide", async () => {
    const bare = makeBare("fresh", false);
    const { jobDir, srcDir } = makeJob("fresh", {
      "index.js": "console.log('bonjour')\n",
      "src/app.ts": "export const x = 1\n",
      "node_modules/pkg/index.js": "module.exports = {}\n",
    });

    const res = await runGitPush({
      jobDir,
      srcDir,
      token: "inutile-locale",
      target: { fullName: "test/fresh", isEmpty: true, defaultBranch: "main" },
      branch: "main",
      commitMessage: "Import de test.zip via RepoDrop (2 fichiers)",
      authorLogin: "alice",
      includeNodeModules: false,
      remoteUrl: bare,
    });

    expect(res.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(res.url).toBe("https://github.com/test/fresh");

    // Le remote contient bien les fichiers… mais PAS node_modules.
    const log = run(["log", "--oneline", "-1"], bare);
    expect(log).toContain("Import de test.zip");
    const files = run(["ls-tree", "-r", "--name-only", "HEAD"], bare).split("\n");
    expect(files.sort()).toEqual(["index.js", "src/app.ts"]);

    // Identité d'auteur = login GitHub.
    const author = run(["log", "-1", "--format=%an <%ae>"], bare);
    expect(author).toBe("alice <alice@users.noreply.github.com>");
  });

  it("inclut node_modules quand demandé", async () => {
    const bare = makeBare("with-nm", false);
    const { jobDir, srcDir } = makeJob("with-nm", {
      "package.json": "{}",
      "node_modules/x/index.js": "x",
    });
    await runGitPush({
      jobDir,
      srcDir,
      token: "x",
      target: { fullName: "test/with-nm", isEmpty: true, defaultBranch: "main" },
      branch: "main",
      commitMessage: "import",
      authorLogin: "bob",
      includeNodeModules: true,
      remoteUrl: bare,
    });
    const files = run(["ls-tree", "-r", "--name-only", "HEAD"], bare).split("\n");
    expect(files).toContain("node_modules/x/index.js");
  });
});

describe("runGitPush — dépôt existant", () => {
  it("ajoute un commit par-dessus l'historique existant (branche par défaut)", async () => {
    const bare = makeBare("existing", true);
    const { jobDir, srcDir } = makeJob("existing", {
      "nouveau.md": "# Ajouté par l'archive\n",
      // existing.txt de l'archive DIFFERENT → l'archive gagne
      "existing.txt": "remplacé par l'archive\n",
    });

    const res = await runGitPush({
      jobDir,
      srcDir,
      token: "x",
      target: { fullName: "test/existing", isEmpty: false, defaultBranch: "main" },
      branch: "main",
      commitMessage: "Import via RepoDrop",
      authorLogin: "carol",
      includeNodeModules: false,
      remoteUrl: bare,
    });

    // Historique préservé : 2 commits.
    const count = Number(run(["rev-list", "--count", "HEAD"], bare));
    expect(count).toBe(2);
    expect(res.sha).toMatch(/^[0-9a-f]{40}$/);

    // L'archive a écrasé existing.txt, le reste du dépôt est conservé.
    const content = run(["show", "HEAD:existing.txt"], bare);
    expect(content).toBe("remplacé par l'archive");
    const files = run(["ls-tree", "-r", "--name-only", "HEAD"], bare).split("\n");
    expect(files).toContain("nouveau.md");
    expect(files).toContain("existing.txt");
  });

  it("pousse sur une branche dédiée sans toucher à main", async () => {
    const bare = makeBare("dedicated", true);
    const { jobDir, srcDir } = makeJob("dedicated", {
      "feature.md": "du contenu\n",
    });

    await runGitPush({
      jobDir,
      srcDir,
      token: "x",
      target: { fullName: "test/dedicated", isEmpty: false, defaultBranch: "main" },
      branch: "import/archive-test",
      commitMessage: "Import branche dédiée",
      authorLogin: "dave",
      includeNodeModules: false,
      remoteUrl: bare,
    });

    const branches = run(["branch", "--list"], bare); // bare: via for-each-ref
    const refs = run(["for-each-ref", "--format=%(refname:short)", "refs/heads"], bare)
      .split("\n")
      .sort();
    expect(refs).toEqual(["import/archive-test", "main"]);

    // main n'a toujours que le commit initial.
    const mainCount = Number(run(["rev-list", "--count", "main"], bare));
    expect(mainCount).toBe(1);
    expect(branches === "" || true).toBe(true);
  });

  it("échoue avec NO_CHANGES si l'archive est identique au dépôt", async () => {
    const bare = makeBare("nochange", true);
    const { jobDir, srcDir } = makeJob("nochange", {
      "existing.txt": "contenu existant\n", // identique au remote
    });
    await expect(
      runGitPush({
        jobDir,
        srcDir,
        token: "x",
        target: { fullName: "test/nochange", isEmpty: false, defaultBranch: "main" },
        branch: "main",
        commitMessage: "import",
        authorLogin: "erin",
        includeNodeModules: false,
        remoteUrl: bare,
      }),
    ).rejects.toMatchObject({ code: "NO_CHANGES" });
  });
});
