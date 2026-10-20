/**
 * Garde-fous de la couche jobs.
 *
 * Deux propriétés de sécurité sont testées ici :
 *   1. `sanitizeBranch` / `sanitizeRepoName` refusent tout ce qui permettrait
 *      d'injecter un argument à git (nom commençant par « - ») ou de remonter
 *      dans l'arborescence (« .. ») — ces valeurs finissent dans des commandes
 *      git et dans des appels à l'API GitHub ;
 *   2. `jobOwnedBy` ne rend jamais le job d'un autre compte : c'est la seule
 *      barrière entre `/api/jobs/<id>` et les jobs des autres utilisateurs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP = path.join(os.tmpdir(), `rd-jobs-${process.pid}`);
// DB_PATH est lu paresseusement par lib/db, donc cet assignement fonctionne.
process.env.DB_PATH = path.join(TMP, "jobs.db");
// JOBS_DIR, lui, est capturé à l'import de lib/config : les `import` étant
// hissés, le poser ici n'aurait aucun effet. Les tests comparent donc à
// `config.jobsDir`, la valeur réellement utilisée.
process.env.JOBS_DIR = path.join(TMP, "work");

import { archivePath, jobDir, jobOwnedBy, sanitizeBranch, sanitizeRepoName } from "@/lib/jobs";
import { config } from "@/lib/config";
import { insertJob } from "@/lib/db";
import { AppError } from "@/lib/errors";

beforeAll(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("sanitizeBranch", () => {
  it("accepte les noms de branche courants", () => {
    for (const ok of ["main", "master", "dev", "feature/mon-topic", "release-1.2", "v1.0.0", "a/b/c"]) {
      expect(sanitizeBranch(ok)).toBe(ok);
    }
  });

  it("retire les espaces de bordure — y compris les sauts de ligne", () => {
    // Le `.trim()` initial est volontaire : « main\n » devient « main », qui
    // est un nom parfaitement valide. Ce n'est pas une faille d'injection :
    // rien ne peut survivre au trim et le jeu de caractères est fermé.
    expect(sanitizeBranch("  ma-branche  ")).toBe("ma-branche");
    expect(sanitizeBranch("main\n")).toBe("main");
    expect(sanitizeBranch("main\t")).toBe("main");
    // Un saut de ligne AU MILIEU ne passe pas le jeu de caractères.
    expect(() => sanitizeBranch("mai n")).toThrow(AppError);
    expect(() => sanitizeBranch("ma\nin")).toThrow(AppError);
  });

  it("refuse l'injection d'arguments git", () => {
    // Un nom commençant par « - » serait interprété comme une option par git.
    for (const bad of [
      "--upload-pack=touch /tmp/pwned",
      "-x",
      "--exec=rm",
      "-",
      "-rf",
    ]) {
      expect(() => sanitizeBranch(bad)).toThrow(AppError);
    }
  });

  it("refuse les remontées de chemin et les séparateurs abusifs", () => {
    for (const bad of ["..", "../main", "a/../b", "a..b", "main/", "a//b", "/main"]) {
      expect(() => sanitizeBranch(bad)).toThrow(AppError);
    }
  });

  it("refuse les suffixes et caractères interdits par git", () => {
    for (const bad of [
      "main.lock", "a.lock", "ma branche", "é", "main~1", "main^",
      "main:", "main?", "main*", "main[0]", "main@{0}", "main.", "a/b.",
    ]) {
      expect(() => sanitizeBranch(bad)).toThrow(AppError);
    }
  });

  it("refuse le vide et les noms trop longs", () => {
    expect(() => sanitizeBranch("")).toThrow(AppError);
    expect(() => sanitizeBranch("   ")).toThrow(AppError);
    expect(() => sanitizeBranch("a".repeat(101))).toThrow(AppError);
    expect(sanitizeBranch("a".repeat(100))).toBe("a".repeat(100));
  });
});

describe("sanitizeRepoName", () => {
  it("accepte les noms de dépôt GitHub valides", () => {
    for (const ok of ["mon-projet", "Mon.Projet_1", "a", "repo123"]) {
      expect(sanitizeRepoName(ok)).toBe(ok);
    }
  });

  it("refuse l'injection d'arguments et les séparateurs", () => {
    for (const bad of ["--mirror", "-x", "a/b", "a\\b", "..", "../x", "a b", "", "  "]) {
      expect(() => sanitizeRepoName(bad)).toThrow(AppError);
    }
  });

  it("borne la longueur à 100 caractères", () => {
    expect(() => sanitizeRepoName("a".repeat(101))).toThrow(AppError);
    expect(sanitizeRepoName("a".repeat(100))).toBe("a".repeat(100));
  });
});

describe("jobOwnedBy — isolation entre comptes", () => {
  const job = {
    id: "job-alice-1",
    login: "alice",
    filename: "projet.zip",
    format: "zip" as const,
    archiveSize: 1024,
    ip: "203.0.113.5",
  };

  it("rend le job à son propriétaire", () => {
    insertJob(job);
    const found = jobOwnedBy(job.id, "alice");
    expect(found).not.toBeNull();
    expect(found?.id).toBe(job.id);
    expect(found?.login).toBe("alice");
  });

  it("ne rend JAMAIS le job d'un autre compte", () => {
    for (const intruder of ["bob", "ALICE", "alice ", "", "mallory"]) {
      expect(jobOwnedBy(job.id, intruder)).toBeNull();
    }
  });

  it("un identifiant inconnu renvoie null", () => {
    expect(jobOwnedBy("job-inexistant", "alice")).toBeNull();
  });

  it("l'identifiant d'un autre compte ne suffit pas : le login doit suivre", () => {
    insertJob({ ...job, id: "job-bob-1", login: "bob", filename: "autre.tar" });
    expect(jobOwnedBy("job-bob-1", "alice")).toBeNull();
    expect(jobOwnedBy("job-bob-1", "bob")?.id).toBe("job-bob-1");
  });
});

describe("chemins de travail", () => {
  it("jobDir et archivePath restent sous le dossier de travail configuré", () => {
    const dir = jobDir("job-alice-1");
    expect(dir.startsWith(config.jobsDir)).toBe(true);
    expect(path.dirname(archivePath("job-alice-1", "zip"))).toBe(dir);
    expect(path.basename(archivePath("job-alice-1", "tar"))).toBe("upload.tar");
  });

  it("le format ne peut pas sortir du dossier du job", () => {
    // archivePath est toujours appelé avec un format déjà validé par
    // detectArchive ; ce test documente la limite : un format arbitraire
    // contenant « / » produirait un sous-chemin, d'où la validation amont.
    const p = archivePath("job-alice-1", "zip");
    expect(p).not.toContain("..");
    expect(path.resolve(p).startsWith(path.resolve(config.jobsDir))).toBe(true);
  });
});
