/**
 * Orchestrateur des jobs : extraction (post-upload) et push (post-aperçu).
 *
 * Les traitements tournent en tâche de fond dans le process Next (cible :
 * déploiement Docker/VPS long-running — pas de serverless). Le token GitHub
 * n'est PAS stocké en base : il est passé en mémoire au moment de l'action
 * utilisateur (requête POST /push) et vit uniquement dans la closure du job.
 */
import path from "node:path";
import fs from "node:fs";
import { AppError, toUserMessage } from "./errors";
import { config } from "./config";
import { getJob, updateJob, failStaleJobs, getJobRow } from "./db";
import { extractArchive } from "./extract";
import { buildPreview } from "./extract/preview";
import { runGitPush, type PushTarget } from "./git";
import { createRepo, getRepo, branchExists } from "./github";
import type { JobRecord, PushOptions } from "./types";

export const jobDir = (id: string) => path.join(config.jobsDir, id);
export const archivePath = (id: string, format: string) =>
  path.join(jobDir(id), `upload.${format}`);

/** Initialisation paresseuse (au premier appel d'une route) :
 *  - marque les jobs interrompus par un redémarrage ;
 *  - démarre le sweeper des dossiers éphémères. */
export function ensureWorkerInit(): void {
  const g = globalThis as unknown as { __repodropInit?: boolean };
  if (g.__repodropInit) return;
  g.__repodropInit = true;
  try {
    failStaleJobs();
  } catch (e) {
    console.error("[worker] failStaleJobs:", e);
  }
  const sweep = () => {
    try {
      fs.mkdirSync(config.jobsDir, { recursive: true });
      const now = Date.now();
      for (const name of fs.readdirSync(config.jobsDir)) {
        const dir = path.join(config.jobsDir, name);
        try {
          const st = fs.statSync(dir);
          const age = now - st.mtimeMs;
          const job = getJob(name);
          const terminal =
            job && (job.status === "done" || job.status === "failed");
          const tooOld = age > 24 * 3600_000;
          const terminalOld = terminal && age > 15 * 60_000;
          const orphan = !job && age > 3600_000;
          if (tooOld || terminalOld || orphan) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };
  sweep();
  const t = setInterval(sweep, 10 * 60_000);
  t.unref?.();
}

// ---------------------------------------------------------------- extraction

export function enqueueExtraction(jobId: string): void {
  setImmediate(() => {
    void runExtraction(jobId).catch((err) => {
      console.error(`[job ${jobId}] extraction error:`, err);
      try {
        updateJob(jobId, { status: "failed", error: toUserMessage(err) });
      } catch {
        /* base indisponible : rien de plus à faire */
      }
    });
  });
}

async function runExtraction(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "queued") return;
  if (!job.format) throw new AppError("UNSUPPORTED");

  updateJob(jobId, { status: "extracting" });

  const res = await extractArchive(
    jobDir(jobId),
    archivePath(jobId, job.format),
    job.format,
    {
      maxExtractBytes: config.limits.maxExtractBytes,
      maxFiles: config.limits.maxFiles,
      maxDepth: config.limits.maxDepth,
      maxPathLength: config.limits.maxPathLength,
    },
  );

  const preview = buildPreview(res);
  updateJob(jobId, { status: "ready", preview });
}

// -------------------------------------------------------------------- push

export function enqueuePush(jobId: string, opts: PushOptions, token: string): void {
  setImmediate(() => {
    void runPush(jobId, opts, token).catch((err) => {
      // Ne devrait pas arriver : runPush attrape déjà. Filet de sécurité.
      console.error(`[job ${jobId}] push error:`, err);
      try {
        updateJob(jobId, { status: "failed", error: toUserMessage(err) });
      } catch {
        /* ignore */
      }
    });
  });
}

const REPO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FULL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}\/[A-Za-z0-9._-]{1,100}$/;

function sanitizeBranch(name: string): string {
  const b = name.trim();
  const valid =
    b.length >= 1 &&
    b.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b) &&
    !b.includes("..") &&
    !b.endsWith("/") &&
    !b.endsWith(".lock");
  if (!valid) {
    throw new AppError("NAME_INVALID", undefined, "nom de branche invalide");
  }
  return b;
}

function sanitizeRepoName(name: string): string {
  const n = name.trim();
  if (!REPO_NAME_RE.test(n)) {
    throw new AppError("NAME_INVALID", undefined, "nom de dépôt invalide");
  }
  return n;
}

async function runPush(
  jobId: string,
  opts: PushOptions,
  token: string,
): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "pushing") return;

  let created = false;
  try {
    const dir = jobDir(jobId);
    const extractDir = path.join(dir, "extract");
    if (!fs.existsSync(extractDir)) throw new AppError("INTERRUPTED");

    // --- source (retrait du dossier racine unique si demandé) ---
    let src = extractDir;
    if (opts.stripRoot !== false && job.preview?.singleRootDir) {
      src = path.join(extractDir, job.preview.singleRootDir);
    }
    if (!fs.existsSync(src)) throw new AppError("INTERRUPTED");

    // --- résolution de la cible ---
    let target: PushTarget;
    if (opts.mode === "new") {
      const name = sanitizeRepoName(opts.name ?? "");
      const r = await createRepo(token, name, opts.private !== false);
      target = {
        fullName: r.full_name,
        isEmpty: true,
        defaultBranch: r.default_branch || "main",
      };
      created = true;
    } else {
      const full = (opts.repo ?? "").trim();
      if (!FULL_NAME_RE.test(full)) {
        throw new AppError("NAME_INVALID", undefined, "nom de dépôt invalide");
      }
      const r = await getRepo(token, full);
      if (r.permissions && r.permissions.push === false) {
        throw new AppError("FORBIDDEN");
      }
      target = {
        fullName: r.full_name,
        isEmpty: r.size === 0,
        defaultBranch: r.default_branch || "main",
      };
    }

    // --- branche ---
    let branch: string;
    if (opts.dedicatedBranch) {
      const slug =
        job.filename.replace(/\.[^.]+$/, "").toLowerCase() || "archive";
      branch = sanitizeBranch(opts.branchName?.trim() || `import/${slug}`);
      if (!target.isEmpty && (await branchExists(token, target.fullName, branch))) {
        throw new AppError("NAME_INVALID", undefined, "la branche existe déjà");
      }
    } else {
      branch = target.defaultBranch;
    }

    // --- message de commit ---
    const commitMessage =
      opts.commitMessage?.trim() ||
      `Import de ${job.filename} via RepoDrop (${job.preview?.fileCount ?? "?"} fichiers)`;

    // --- exécution ---
    const result = await runGitPush({
      jobDir: dir,
      srcDir: src,
      token,
      target,
      branch,
      commitMessage,
      authorLogin: job.login,
      includeNodeModules: opts.includeNodeModules === true,
    });

    updateJob(jobId, {
      status: "done",
      error: null,
      push_opts: opts,
      push_result: {
        url: result.url,
        fullName: target.fullName,
        branch,
        commitSha: result.sha,
        created,
      },
    });
  } catch (err) {
    // Log serveur sans token (le token n'apparaît jamais dans les erreurs).
    console.error(`[job ${jobId}] push failed:`, err);
    updateJob(jobId, { status: "failed", error: toUserMessage(err) });
    if (created) {
      console.error(
        `[job ${jobId}] le dépôt a été créé mais le push a échoué (dépôt laissé vide)`,
      );
    }
  }
}

/** Vérifie l'appartenance d'un job à un utilisateur connecté. */
export function jobOwnedBy(jobId: string, login: string): JobRecord | null {
  const row = getJobRow(jobId);
  if (!row || row.login !== login) return null;
  return getJob(jobId);
}
