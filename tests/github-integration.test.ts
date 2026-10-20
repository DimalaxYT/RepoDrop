/**
 * Intégration : le vrai client GitHub contre une fausse API, en HTTP réel.
 *
 * Ce que ce fichier couvre et que les tests unitaires (fetch injecté) ne
 * couvrent pas :
 *   - la construction des URLs et de la query string (chemins, `ref`) ;
 *   - l'en-tête `Authorization: Bearer <token>` réellement émis ;
 *   - le suivi de pagination via l'en-tête `Link` ;
 *   - le mappage des statuts HTTP → codes d'erreur métier ;
 *   - le streaming d'une archive, avec contrôle du `Content-Length` annoncé.
 *
 * Rien n'est simulé côté réseau : `lib/github.ts` parle en HTTP à
 * `tests/mock-github.mjs` sur 127.0.0.1. Le jeton étant un paramètre explicite
 * du client, aucune session Next.js n'est nécessaire ici.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TAR_BYTES, ZIP_BYTES, startMockGithub } from "./mock-github.mjs";

type MockServer = Awaited<ReturnType<typeof startMockGithub>>;
type GitHub = typeof import("@/lib/github");
type Err = import("@/lib/errors").AppError;
type ErrCtor = typeof import("@/lib/errors").AppError;

let mock: MockServer;
let gh: GitHub;
/**
 * `AppError` est importé dynamiquement du MÊME registre de modules que le
 * client : après `vi.resetModules()`, un import statique donnerait une seconde
 * copie de la classe et `instanceof` échouerait à tort.
 */
let AppError: ErrCtor;

/** Jeton accepté par le mock (le reste est refusé en 401). */
const TOKEN = "gho_test";
const BAD_TOKEN = "gho_invalide";

beforeAll(async () => {
  mock = await startMockGithub();
  process.env.GITHUB_API_URL = mock.url;

  // Registre vierge : lib/config capture l'URL de l'API à l'import.
  vi.resetModules();
  [{ AppError }, gh] = [await import("@/lib/errors"), await import("@/lib/github")];
});

afterAll(async () => {
  await mock.stop();
  vi.resetModules();
});

beforeEach(() => {
  mock.calls.length = 0;
  mock.patches.length = 0;
});

/** Requêtes réellement reçues par le mock, sous la forme "METHODE /chemin". */
const requested = () => mock.calls.map((c) => `${c.method} ${c.path}`);

const codeOf = async (p: Promise<unknown>) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return err as Err;
};

describe("authentification", () => {
  it("envoie le jeton en Bearer (sinon le mock répond 401)", async () => {
    const viewer = await gh.getViewer(TOKEN);
    expect(viewer.login).toBe("dimalaxyt");
    expect(viewer.name).toBe("Dima");
    expect(requested()).toContain("GET /user");
  });

  it("un jeton refusé devient FORBIDDEN", async () => {
    const err = await codeOf(gh.listRepos(BAD_TOKEN));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.detail).toContain("401");
  });

  it("un quota épuisé devient RATE_LIMITED", async () => {
    // Le mock répond 403 avec X-RateLimit-Remaining: 0 sur ce dépôt.
    const err = await codeOf(gh.getRepoInfo(TOKEN, "dimalaxyt", "epuise"));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.detail).toContain("quota");
  });
});

describe("liste des dépôts", () => {
  it("demande 100 dépôts par page, triés par activité", async () => {
    await gh.listRepos(TOKEN);
    const calls = mock.calls.filter((c) => c.path === "/user/repos");
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].search).toContain("per_page=100");
    expect(calls[0].search).toContain("sort=updated");
    expect(calls[0].search).toContain("affiliation=owner,collaborator");
  });

  it("enchaîne les pages tant qu'elles sont pleines", async () => {
    // Le client n'utilise pas l'en-tête Link : il incrémente le numéro de page
    // et s'arrête dès qu'une page revient incomplète. Avec perPage=2, la page 1
    // est pleine (2 dépôts) donc la page 2 est demandée, puis incomplète (1).
    const res = await gh.listRepos(TOKEN, { perPage: 2 });
    expect(mock.calls.filter((c) => c.path === "/user/repos")).toHaveLength(2);
    expect(res.repos).toHaveLength(3);
    expect(res.pages).toBe(2);
    expect(res.truncated).toBe(false);
  });

  it("s'arrête au plafond de pages et signale la troncature", async () => {
    // perPage=2 rend la page 1 « pleine », donc la liste serait continuée
    // sans le plafond : c'est ce qui rend truncated observable.
    const res = await gh.listRepos(TOKEN, { perPage: 2, maxPages: 1 });
    expect(res.repos).toHaveLength(2);
    expect(res.pages).toBe(1);
    expect(res.truncated).toBe(true);
  });

  it("mappe les droits d'écriture et l'état archivé", async () => {
    const { repos } = await gh.listRepos(TOKEN, { perPage: 2 });
    const byName = (n: string) => repos.find((r) => r.full_name === n);
    expect(byName("dimalaxyt/mon-projet")?.can.push).toBe(true);
    expect(byName("dimalaxyt/mon-projet")?.can.admin).toBe(true);
    expect(byName("autre-org/lecture-seule")?.can.push).toBe(false);
    expect(byName("dimalaxyt/legacy")?.archived).toBe(true);
    expect(byName("dimalaxyt/legacy")?.private).toBe(true);
  });
});

describe("navigation dans le dépôt", () => {
  it("liste la racine, dossiers en premier", async () => {
    const tree = await gh.getTree(TOKEN, "dimalaxyt", "mon-projet", "", "main");
    expect(tree.empty).toBe(false);
    expect(tree.entries[0]).toMatchObject({ name: "src", type: "dir" });
    expect(tree.entries.map((e) => e.name)).toContain("README.md");
    expect(requested()).toContain("GET /repos/dimalaxyt/mon-projet/contents/");
  });

  it("construit l'URL des chemins imbriqués", async () => {
    await gh.getTree(TOKEN, "dimalaxyt", "mon-projet", "src/app", "main");
    expect(requested()).toContain("GET /repos/dimalaxyt/mon-projet/contents/src/app");
  });

  it("propage la référence en query string", async () => {
    await gh.getTree(TOKEN, "dimalaxyt", "mon-projet", "", "dev");
    const call = mock.calls.find((c) => c.path.endsWith("/contents/"));
    expect(call?.search).toContain("ref=dev");
  });

  it("un dépôt sans commit rend une liste vide plutôt qu'une erreur", async () => {
    const tree = await gh.getTree(TOKEN, "dimalaxyt", "vide", "", "main");
    expect(tree.empty).toBe(true);
    expect(tree.entries).toHaveLength(0);
  });

  it("une référence inconnue sur un sous-chemin devient NOT_FOUND", async () => {
    const err = await codeOf(gh.getTree(TOKEN, "dimalaxyt", "mon-projet", "src", "branche-inconnue"));
    expect(err.code).toBe("NOT_FOUND");
  });

  it("liste les branches avec leur protection", async () => {
    const branches = await gh.listBranches(TOKEN, "dimalaxyt", "mon-projet");
    expect(branches.map((b) => b.name)).toEqual(["main", "dev"]);
    expect(branches.find((b) => b.name === "main")?.protected).toBe(true);
  });
});

describe("fichiers", () => {
  it("rend un fichier texte avec son langage", async () => {
    const blob = await gh.getBlob(TOKEN, "dimalaxyt", "mon-projet", "README.md", "main");
    expect(blob.binary).toBe(false);
    expect(blob.tooBig).toBe(false);
    expect(blob.content).toContain("Mon projet");
    expect(blob.language).toBe("markdown");
    expect(blob.lines).toBeGreaterThan(1);
  });

  it("reconnaît le langage des autres fichiers", async () => {
    const pkg = await gh.getBlob(TOKEN, "dimalaxyt", "mon-projet", "package.json", "main");
    expect(pkg.language).toBe("json");
    const ts = await gh.getBlob(TOKEN, "dimalaxyt", "mon-projet", "src/index.ts", "main");
    expect(ts.language).toBe("typescript");
    expect(ts.content).toContain("hello");
  });

  it("détecte un fichier binaire et ne renvoie pas son contenu", async () => {
    const blob = await gh.getBlob(TOKEN, "dimalaxyt", "mon-projet", "logo.png", "main");
    expect(blob.binary).toBe(true);
    expect(blob.content).toBe("");
  });

  it("un dossier n'est pas un fichier", async () => {
    const err = await codeOf(gh.getBlob(TOKEN, "dimalaxyt", "mon-projet", "docs", "main"));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.detail).toContain("dossier");
  });
});

describe("écritures sur GitHub", () => {
  it("renvoie le PATCH attendu", async () => {
    const repo = await gh.updateRepo(TOKEN, "dimalaxyt", "mon-projet", {
      name: "nouveau-nom",
      description: "Nouvelle description",
      private: true,
    });
    expect(mock.patches).toHaveLength(1);
    expect(mock.patches[0]).toMatchObject({
      name: "nouveau-nom",
      description: "Nouvelle description",
      private: true,
    });
    expect(repo.full_name).toBe("dimalaxyt/nouveau-nom");
    expect(requested()).toContain("PATCH /repos/dimalaxyt/mon-projet");
  });

  it("omet du PATCH les champs non fournis", async () => {
    await gh.updateRepo(TOKEN, "dimalaxyt", "mon-projet", { name: "autre" });
    expect(mock.patches[0]).toEqual({ name: "autre" });
    expect("description" in mock.patches[0]).toBe(false);
    expect("private" in mock.patches[0]).toBe(false);
  });

  it("refuse la suppression si la confirmation ne correspond pas", async () => {
    const err = await codeOf(gh.deleteRepo(TOKEN, "dimalaxyt", "mon-projet", "mauvais"));
    expect(err.code).toBe("CONFIRM_MISMATCH");
    // Vérification faite avant tout appel réseau.
    expect(requested().filter((c) => c.startsWith("DELETE"))).toHaveLength(0);
  });

  it("supprime quand la confirmation est exacte", async () => {
    await gh.deleteRepo(TOKEN, "dimalaxyt", "mon-projet", "dimalaxyt/mon-projet");
    expect(requested()).toContain("DELETE /repos/dimalaxyt/mon-projet");
  });

  it("un 404 sur DELETE signale le scope manquant delete_repo", async () => {
    const err = await codeOf(gh.deleteRepo(TOKEN, "dimalaxyt", "legacy", "dimalaxyt/legacy"));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.detail).toContain("delete_repo");
  });
});

describe("téléchargement d'une archive", () => {
  it("fluxe le zip octet pour octet", async () => {
    const res = await gh.streamArchive(TOKEN, "dimalaxyt", "mon-projet", "main", "zip");
    expect(res.contentType).toBe("application/zip");
    expect(res.filename).toBe("mon-projet-main.zip");
    expect(res.contentLength).toBe(ZIP_BYTES.length);

    const received = Buffer.from(await new Response(res.body).arrayBuffer());
    expect(received).toEqual(ZIP_BYTES);
    // Marqueur EOCD en fin d'archive : ce qui arrive est une archive complète.
    expect(received.subarray(-22, -18).toString("hex")).toBe("504b0506");
  });

  it("fluxe le tar.gz octet pour octet", async () => {
    const res = await gh.streamArchive(TOKEN, "dimalaxyt", "mon-projet", "main", "tar.gz");
    expect(res.contentType).toBe("application/gzip");
    expect(res.filename).toBe("mon-projet-main.tar.gz");
    const received = Buffer.from(await new Response(res.body).arrayBuffer());
    expect(received).toEqual(TAR_BYTES);
    // Signature gzip.
    expect(received[0]).toBe(0x1f);
    expect(received[1]).toBe(0x8b);
  });

  it("propage la référence dans l'URL de l'archive", async () => {
    await gh.streamArchive(TOKEN, "dimalaxyt", "mon-projet", "dev", "zip");
    expect(requested()).toContain("GET /repos/dimalaxyt/mon-projet/zipball/dev");
  });

  it("une référence inconnue devient NOT_FOUND", async () => {
    const err = await codeOf(
      gh.streamArchive(TOKEN, "dimalaxyt", "mon-projet", "inconnue", "zip"),
    );
    expect(err.code).toBe("NOT_FOUND");
    expect(err.detail).toContain("référence inconnue");
  });

  it("refuse une archive annoncée au-delà du plafond, avant tout transfert", async () => {
    const err = await codeOf(gh.streamArchive(TOKEN, "dimalaxyt", "legacy", "master", "zip"));
    expect(err.code).toBe("ARCHIVE_TOO_BIG");
    expect(err.detail).toContain("300 Mo");
    expect(err.detail).toContain("250 Mo");
  });

  it("construit un nom de fichier sûr", () => {
    expect(gh.archiveFilename("mon-projet", "main", "zip")).toBe("mon-projet-main.zip");
    expect(gh.archiveFilename("mon-projet", "feature/x", "tar.gz")).toBe(
      "mon-projet-feature-x.tar.gz",
    );
    // Caractères interdits par les systèmes de fichiers, et points en tête.
    expect(gh.archiveFilename("..", "..", "zip")).toBe("depot-repo.zip");
  });
});
