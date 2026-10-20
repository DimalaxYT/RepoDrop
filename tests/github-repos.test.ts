/**
 * Client GitHub : navigation dans les dépôts (arborescence, fichiers) et
 * actions rapides (renommage, visibilité, suppression).
 *
 * `fetch` est injecté partout : aucun appel réseau réel, et chaque test
 * vérifie l'URL et le corps réellement envoyés à GitHub.
 *
 * NB : `GITHUB_API_URL` ne peut pas être posé ici — les `import` sont hissés
 * au-dessus des instructions, donc `lib/config` serait déjà évalué. La base
 * configurable est vérifiée dans son propre test, avec `vi.resetModules()`.
 */
import { describe, expect, it, vi } from "vitest";

import {
  archiveFilename,
  assertRepoName,
  deleteRepo,
  getBlob,
  getTree,
  languageOf,
  listBranches,
  listRepos,
  MAX_VIEW_BYTES,
  safeRef,
  safeRepoPath,
  streamArchive,
  updateRepo,
  type FetchImpl,
} from "@/lib/github";
import { AppError, toUserMessage } from "@/lib/errors";

const TOKEN = "gho_test_token";

/** Faux `fetch` programmable : une réponse par motif d'URL. */
function fakeFetch(
  routes: Record<string, unknown>,
  calls: { url: string; init?: RequestInit }[] = [],
): FetchImpl {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) {
      return new Response(JSON.stringify({ message: `no route for ${url}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const value = routes[key];
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as FetchImpl;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("validation des chemins et des noms", () => {
  it("normalise un chemin et renvoie une chaîne vide pour la racine", () => {
    expect(safeRepoPath("")).toBe("");
    expect(safeRepoPath("/")).toBe("");
    expect(safeRepoPath(".")).toBe("");
    expect(safeRepoPath("  src/lib/  ")).toBe("src/lib");
    expect(safeRepoPath("a//b")).toBe("a/b");
  });

  it("refuse toute tentative de sortie du dépôt", () => {
    for (const bad of ["../secret", "src/../../etc/passwd", "/etc/passwd", "a/./b", "a\0b"]) {
      expect(() => safeRepoPath(bad)).toThrow(AppError);
    }
  });

  it("refuse les chemins et segments hors limites", () => {
    expect(() => safeRepoPath("x".repeat(256))).toThrow(AppError);
    // n segments de 7 caractères = 8n − 1 : 150 → 1199 (refusé), 125 → 999 (accepté).
    expect(() => safeRepoPath(Array(150).fill("dossier").join("/"))).toThrow(AppError);
    expect(safeRepoPath(Array(125).fill("dossier").join("/"))).toHaveLength(999);
  });

  it("valide les noms de propriétaire et de dépôt", () => {
    expect(assertRepoName("DimalaxYT", "owner")).toBe("DimalaxYT");
    expect(assertRepoName("mon.repo-1", "repo")).toBe("mon.repo-1");
    for (const bad of ["", "  ", "a/b", "../x", "a b", "-tiret", "x".repeat(101)]) {
      expect(() => assertRepoName(bad, "repo")).toThrow(AppError);
    }
  });

  it("valide une référence de branche", () => {
    expect(safeRef("")).toBe("");
    expect(safeRef(null)).toBe("");
    expect(safeRef("feature/mon-topic")).toBe("feature/mon-topic");
    for (const bad of ["main main", "a~1", "a^b", "a?b", "a*b", "a[b]", "a//b", "x".repeat(256)]) {
      expect(() => safeRef(bad)).toThrow(AppError);
    }
  });

  it("reconnaît quelques langages par extension", () => {
    expect(languageOf("src/app/page.tsx")).toBe("tsx");
    expect(languageOf("README.md")).toBe("markdown");
    expect(languageOf("Dockerfile")).toBe("dockerfile");
    expect(languageOf("dockerfile")).toBe("dockerfile");
    expect(languageOf("bin/machin")).toBe("text");
  });
});

describe("liste des dépôts", () => {
  const repo = (n: number, push: boolean) => ({
    full_name: `dimalaxyt/depot-${n}`,
    name: `depot-${n}`,
    owner: { login: "DimalaxYT" },
    private: n % 2 === 0,
    default_branch: "main",
    pushed_at: "2026-01-01T00:00:00Z",
    size: 100 + n,
    permissions: { pull: true, push, admin: push },
  });

  it("s'arrête dès qu'une page est incomplète et projette les droits", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = fakeFetch(
      {
        // « &page=1 » et non « page=1 » : ce dernier est aussi un sous-chaîne
        // de « per_page=100 » et ferait matcher toutes les pages.
        "&page=1": Array.from({ length: 100 }, (_, i) => repo(i, i % 3 !== 0)),
        "&page=2": [repo(200, true), repo(201, false)],
      },
      calls,
    );

    const res = await listRepos(TOKEN, { fetchImpl });
    expect(res.repos).toHaveLength(102);
    expect(res.truncated).toBe(false);
    expect(res.pages).toBe(2);
    // Le fixture donne push = (i % 3 !== 0) : depot-0 est en lecture seule,
    // depot-1 est poussable. Les deux projections doivent être fidèles.
    expect(res.repos[0]).toMatchObject({
      full_name: "dimalaxyt/depot-0",
      owner: "DimalaxYT",
      private: true,
      can: { pull: true, push: false, admin: false },
    });
    expect(res.repos[1]).toMatchObject({
      full_name: "dimalaxyt/depot-1",
      can: { pull: true, push: true, admin: true },
    });
    // La base configurable a son propre test : ici on vérifie la requête.
    expect(calls[0].url).toContain(
      "/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100&page=1",
    );
  });

  it("signale la troncature quand le plafond de pages est atteint", async () => {
    const full = Array.from({ length: 100 }, (_, i) => repo(i, true));
    const res = await listRepos(TOKEN, {
      maxPages: 2,
      fetchImpl: fakeFetch({ "/user/repos": full }),
    });
    expect(res.repos).toHaveLength(200);
    expect(res.truncated).toBe(true);
  });

  it("borne maxPages pour ne pas multiplier les appels", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const full = Array.from({ length: 100 }, (_, i) => repo(i, true));
    const res = await listRepos(TOKEN, {
      maxPages: 999,
      fetchImpl: fakeFetch({ "/user/repos": full }, calls),
    });
    expect(res.pages).toBe(10);
    expect(calls).toHaveLength(10);
  });
});

describe("arborescence", () => {
  it("trie les dossiers d'abord, puis les fichiers par nom", async () => {
    const fetchImpl = fakeFetch({
      "/contents/": [
        { name: "zeta.ts", path: "zeta.ts", sha: "a", size: 10, type: "file" },
        { name: "Alpha", path: "Alpha", sha: "b", size: 0, type: "dir" },
        { name: "beta.ts", path: "beta.ts", sha: "c", size: 20, type: "file" },
        { name: "src", path: "src", sha: "d", size: 0, type: "dir" },
      ],
    });
    const { entries, empty } = await getTree(TOKEN, "dimalaxyt", "depot", "", "", fetchImpl);
    expect(empty).toBe(false);
    expect(entries.map((e) => e.name)).toEqual(["Alpha", "src", "beta.ts", "zeta.ts"]);
    expect(entries[0].type).toBe("dir");
  });

  it("encode chaque segment de chemin et transmet la branche", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = fakeFetch({ "/contents/": [] }, calls);
    await getTree(TOKEN, "dimalaxyt", "depot", "src/mon dossier", "feature/x", fetchImpl);
    expect(calls[0].url).toContain("/contents/src/mon%20dossier?ref=feature%2Fx");
  });

  it("un dépôt sans commit renvoie une liste vide, pas une erreur", async () => {
    const fetchImpl = fakeFetch({
      "/contents/": json({ message: "This repository is empty." }, 404),
    });
    const res = await getTree(TOKEN, "dimalaxyt", "depot", "", "", fetchImpl);
    expect(res).toEqual({ entries: [], empty: true });
  });

  it("une 404 sur un sous-dossier reste une erreur", async () => {
    const fetchImpl = fakeFetch({ "/contents/src": json({ message: "Not Found" }, 404) });
    await expect(getTree(TOKEN, "o", "r", "src", "", fetchImpl)).rejects.toThrow(AppError);
  });

  it("refuse un chemin qui sort du dépôt avant tout appel réseau", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = fakeFetch({ "/contents/": [] }, calls);
    await expect(getTree(TOKEN, "o", "r", "../../etc", "", fetchImpl)).rejects.toThrow(
      AppError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("aperçu de fichier", () => {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  it("décode le base64 en texte et compte les lignes", async () => {
    const fetchImpl = fakeFetch({
      "/contents/README.md": {
        name: "README.md",
        path: "README.md",
        type: "file",
        size: 11,
        sha: "abc",
        content: b64("ligne 1\nligne 2"),
        encoding: "base64",
      },
    });
    const blob = await getBlob(TOKEN, "o", "r", "README.md", "main", fetchImpl);
    expect(blob.binary).toBe(false);
    expect(blob.tooBig).toBe(false);
    expect(blob.content).toBe("ligne 1\nligne 2");
    expect(blob.lines).toBe(2);
    expect(blob.language).toBe("markdown");
    expect(blob.html_url).toBe("https://github.com/o/r/blob/main/README.md");
  });

  it("ne transfère rien au-delà de la taille maximale", async () => {
    const fetchImpl = fakeFetch({
      "/contents/big.bin": {
        name: "big.bin",
        path: "big.bin",
        type: "file",
        size: MAX_VIEW_BYTES + 1,
        sha: "x",
        content: b64("peu importe"),
      },
    });
    const blob = await getBlob(TOKEN, "o", "r", "big.bin", "", fetchImpl);
    expect(blob.tooBig).toBe(true);
    expect(blob.content).toBe("");
  });

  it("détecte un contenu binaire (UTF-8 invalide)", async () => {
    const fetchImpl = fakeFetch({
      "/contents/img.png": {
        name: "img.png",
        path: "img.png",
        type: "file",
        size: 4,
        sha: "x",
        // 0xff 0xfe ne sont pas de l'UTF-8 valide.
        content: Buffer.from([0xff, 0xfe, 0xfd, 0xfc]).toString("base64"),
      },
    });
    const blob = await getBlob(TOKEN, "o", "r", "img.png", "", fetchImpl);
    expect(blob.binary).toBe(true);
    expect(blob.content).toBe("");
  });

  it("détecte un contenu binaire (octet nul)", async () => {
    const fetchImpl = fakeFetch({
      "/contents/data.bin": {
        name: "data.bin",
        path: "data.bin",
        type: "file",
        size: 3,
        sha: "x",
        content: Buffer.from([0x61, 0x00, 0x62]).toString("base64"),
      },
    });
    const blob = await getBlob(TOKEN, "o", "r", "data.bin", "", fetchImpl);
    expect(blob.binary).toBe(true);
  });

  it("un dossier demandé comme fichier est une erreur explicite", async () => {
    const fetchImpl = fakeFetch({
      "/contents/src": { name: "src", path: "src", type: "dir", size: 0, sha: "x" },
    });
    const err = await getBlob(TOKEN, "o", "r", "src", "", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("NOT_FOUND");
    expect(toUserMessage(err)).toContain("dossier");
  });

  it("exige un chemin non vide", async () => {
    const fetchImpl = fakeFetch({ "/contents/": [] });
    await expect(getBlob(TOKEN, "o", "r", "", "", fetchImpl)).rejects.toThrow(AppError);
  });
});

describe("actions rapides", () => {
  it("renomme un dépôt via PATCH et renvoie le dépôt mis à jour", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = fakeFetch(
      {
        "/repos/o/r": {
          full_name: "o/nouveau-nom",
          name: "nouveau-nom",
          owner: { login: "o" },
          private: false,
          default_branch: "main",
          permissions: { push: true, admin: true },
        },
      },
      calls,
    );

    const updated = await updateRepo(TOKEN, "o", "r", { name: "nouveau-nom" }, fetchImpl);
    expect(updated.full_name).toBe("o/nouveau-nom");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: "nouveau-nom" });
  });

  it("change la visibilité et la description dans le même PATCH", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = fakeFetch(
      { "/repos/o/r": { full_name: "o/r", name: "r", owner: { login: "o" } } },
      calls,
    );
    await updateRepo(TOKEN, "o", "r", { private: true, description: "Un dépôt" }, fetchImpl);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      private: true,
      description: "Un dépôt",
    });
  });

  it("refuse un nouveau nom invalide et un PATCH vide", async () => {
    const fetchImpl = fakeFetch({ "/repos/o/r": {} });
    await expect(updateRepo(TOKEN, "o", "r", { name: "a/b" }, fetchImpl)).rejects.toThrow(
      AppError,
    );
    await expect(updateRepo(TOKEN, "o", "r", {}, fetchImpl)).rejects.toThrow(AppError);
  });

  it("liste les branches", async () => {
    const fetchImpl = fakeFetch({
      "/branches": [
        { name: "main", protected: true },
        { name: "dev", protected: false },
      ],
    });
    const branches = await listBranches(TOKEN, "o", "r", fetchImpl);
    expect(branches).toEqual([
      { name: "main", protected: true },
      { name: "dev", protected: false },
    ]);
  });
});

describe("suppression d'un dépôt", () => {
  it("refuse sans confirmation exacte, sans appeler GitHub", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = fakeFetch({ "/repos/o/r": {} }, calls);
    await expect(deleteRepo(TOKEN, "o", "r", "o/autre", fetchImpl)).rejects.toThrow(AppError);
    await expect(deleteRepo(TOKEN, "o", "r", "", fetchImpl)).rejects.toThrow(AppError);
    expect(calls).toHaveLength(0);
  });

  it("supprime quand la confirmation correspond exactement", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    }) as unknown as FetchImpl;

    await expect(deleteRepo(TOKEN, "o", "r", "o/r", fetchImpl)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].url.endsWith("/repos/o/r")).toBe(true);
  });

  it("traduit une 404 en refus explicite mentionnant le scope delete_repo", async () => {
    const fetchImpl = fakeFetch({ "/repos/o/r": json({ message: "Not Found" }, 404) });
    const err = await deleteRepo(TOKEN, "o", "r", "o/r", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");
    expect(toUserMessage(err)).toContain("delete_repo");
  });

  it("un quota épuisé est traduit en RATE_LIMITED", async () => {
    const fetchImpl = fakeFetch({
      "/repos/o/r": json({ message: "API rate limit exceeded" }, 403),
    });
    await expect(deleteRepo(TOKEN, "o", "r", "o/r", fetchImpl)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("base de l'API configurable", () => {
  it("GITHUB_API_URL remplace api.github.com (permet un serveur de test)", async () => {
    process.env.GITHUB_API_URL = "https://api.example.test";
    vi.resetModules();
    const mod = await import("@/lib/github");

    const calls: { url: string; init?: RequestInit }[] = [];
    await mod.listBranches(TOKEN, "o", "r", fakeFetch({ "/branches": [] }, calls));

    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith("https://api.example.test/")).toBe(true);

    delete process.env.GITHUB_API_URL;
    vi.resetModules();
  });

  it("une barre oblique finale est retirée de la base", async () => {
    process.env.GITHUB_API_URL = "https://api.example.test///";
    vi.resetModules();
    const { config } = await import("@/lib/config");
    expect(config.github.apiUrl).toBe("https://api.example.test");

    delete process.env.GITHUB_API_URL;
    vi.resetModules();
  });
});

describe("archive d'un dépôt", () => {
  /** Faux `fetch` renvoyant un corps binaire streamable. */
  function binaryFetch(
    bytes: Uint8Array,
    headers: Record<string, string> = {},
    calls: { url: string; init?: RequestInit }[] = [],
  ): FetchImpl {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      // `Uint8Array<ArrayBufferLike>` n'est pas accepted tel quel par BodyInit
      // depuis les génériques de tableaux typés (TS 5.7) : on copie le tampon.
      const body = bytes.slice().buffer as ArrayBuffer;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream", ...headers },
      });
    }) as unknown as FetchImpl;
  }

  it("construit un nom de fichier lisible et sans caractère dangereux", () => {
    expect(archiveFilename("mon-projet", "main", "zip")).toBe("mon-projet-main.zip");
    expect(archiveFilename("mon-projet", "feature/x", "tar.gz")).toBe(
      "mon-projet-feature-x.tar.gz",
    );
    // Séparateurs, guillemets et caractères de contrôle ne passent pas.
    const hostile = archiveFilename('a"b\rc', "../../x", "zip");
    expect(hostile).not.toContain('"');
    expect(hostile).not.toContain("\r");
    expect(hostile).not.toContain("/");
    expect(hostile.endsWith(".zip")).toBe(true);
    // Repli quand tout est nettoyé.
    expect(archiveFilename("...", "", "zip")).toBe("depot-repo.zip");
    // Un nom très long est tronqué.
    expect(archiveFilename("x".repeat(500), "main", "zip").length).toBeLessThanOrEqual(90);
  });

  it("demande zipball ou tarball, avec la branche encodée", async () => {
    const zipCalls: { url: string; init?: RequestInit }[] = [];
    await streamArchive(TOKEN, "o", "r", "main", "zip", binaryFetch(new Uint8Array([1]), {}, zipCalls));
    expect(zipCalls[0].url).toContain("/repos/o/r/zipball/main");

    const tarCalls: { url: string; init?: RequestInit }[] = [];
    await streamArchive(TOKEN, "o", "r", "feature/x", "tar.gz", binaryFetch(new Uint8Array([1]), {}, tarCalls));
    expect(tarCalls[0].url).toContain("/repos/o/r/tarball/feature%2Fx");
  });

  it("stream le corps sans le bufferiser et renvoie le bon type MIME", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
    const a = await streamArchive(TOKEN, "o", "r", "main", "zip", binaryFetch(bytes));
    expect(a.contentType).toBe("application/zip");
    expect(a.filename).toBe("r-main.zip");
    expect(a.body).toBeInstanceOf(ReadableStream);

    const chunks: Uint8Array[] = [];
    const reader = a.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    expect(total).toBe(bytes.length);

    const gz = await streamArchive(TOKEN, "o", "r", "", "tar.gz", binaryFetch(bytes));
    expect(gz.contentType).toBe("application/gzip");
  });

  it("refuse une archive annoncée au-delà du plafond, avant tout transfert", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = binaryFetch(new Uint8Array([1]), {
      "Content-Length": String(300 * 1024 * 1024), // 300 Mo > plafond de 250 Mo
    }, calls);
    const err = await streamArchive(TOKEN, "o", "r", "main", "zip", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("ARCHIVE_TOO_BIG");
    expect(toUserMessage(err)).toContain("plafond");
  });

  it("accepte une archive sous le plafond et remonte sa taille", async () => {
    const a = await streamArchive(
      TOKEN, "o", "r", "main", "zip",
      binaryFetch(new Uint8Array([1]), { "Content-Length": "1048576" }),
    );
    expect(a.contentLength).toBe(1048576);
  });

  it("un dépôt vide ou une branche inconnue est expliqué", async () => {
    const fetchImpl = fakeFetch({ "/zipball/": json({ message: "Not Found" }, 404) });
    const err = await streamArchive(TOKEN, "o", "r", "inconnue", "zip", fetchImpl).catch((e) => e);
    expect((err as AppError).code).toBe("NOT_FOUND");
    expect(toUserMessage(err)).toContain("dépôt vide");
  });

  it("un quota épuisé reste RATE_LIMITED", async () => {
    const fetchImpl = fakeFetch({ "/zipball/": json({ message: "rate limit" }, 403) });
    await expect(streamArchive(TOKEN, "o", "r", "main", "zip", fetchImpl)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("valide le nom du dépôt avant d'appeler GitHub", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await expect(
      streamArchive(TOKEN, "o", "../x", "main", "zip", binaryFetch(new Uint8Array([1]), {}, calls)),
    ).rejects.toThrow(AppError);
    expect(calls).toHaveLength(0);
  });
});
