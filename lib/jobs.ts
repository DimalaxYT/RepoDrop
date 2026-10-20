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
import {
  getJob,
  updateJob,
  failStaleJobs,
  getJobRow,
  logEvent,
  pruneEvents,
} from "./db";
import { announcePush, ensureDiscordMonitor } from "./discord/monitor";
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
 *  - démarre le sweeper des dossiers éphémères ;
 *  - démarre/auto-répare le moniteur Discord.
 *
 * Le drapeau est posé à la **fin** : si une étape échoue, la prochaine
 * requête retente l'initialisation complète (toutes les étapes sont
 * idempotentes) au lieu de laisser le worker à moitié mort pour tout le
 * reste du vie du process. */
export function ensureWorkerInit(): void {
  const g = globalThis as unknown as { __repodropInit?: boolean };
  if (g.__repodropInit) return;
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
  try {
    pruneEvents(90 * 24 * 3_600_000); // rétention du journal d'activité : 90 jours
  } catch (e) {
    // Best-effort : une purge qui échoue ne doit pas empêcher le démarrage
    // du moniteur Discord juste en dessous (ni figer l'initialisation).
    console.error("[worker] pruneEvents:", e);
  }

  // Bot Discord : démarrage + auto-réparation (no-op si non configuré).
  try {
    ensureDiscordMonitor();
  } catch (e) {
    console.error("[worker] moniteur Discord :", e);
  }
  g.__repodropInit = true;
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

/**
 * Valide un nom de branche avant de le passer à git.
 *
 * Exporté pour être testé directement : c'est lui qui empêche l'injection
 * d'arguments git (tout nom commençant par « - » est refusé) et les chemins
 * qui remonteraient (« .. »).
 */
export function sanitizeBranch(name: string): string {
  const b = name.trim();
  // Règles alignées sur `git check-ref-format` pour les cas courants : un nom
  // accepté ici mais refusé par git ne produirait qu'un échec obscur au push.
  const valid =
    b.length >= 1 &&
    b.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b) &&
    !b.includes("..") &&
    !b.includes("//") && // deux barres obliques consécutives : refname invalide
    !b.includes("@{") && // réservé par git (syntaxe de révision)
    !b.endsWith("/") &&
    !b.endsWith(".") && // un refname ne peut pas se terminer par un point
    !b.endsWith(".lock");
  if (!valid) {
    throw new AppError("NAME_INVALID", undefined, "nom de branche invalide");
  }
  return b;
}

/** Valide un nom de dépôt avant création sur GitHub (mêmes enjeux). */
export function sanitizeRepoName(name: string): string {
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

    // Journal d'activité (panel staff) + annonce Discord.
    const files = job.preview?.fileCount ?? 0;
    const bytes = job.preview?.totalSize ?? 0;
    logEvent({
      kind: "push",
      login: job.login,
      detail: {
        ok: true,
        jobId,
        repo: target.fullName,
        branch,
        sha: result.sha,
        files,
        bytes,
        filename: job.filename,
        created,
        mode: opts.mode,
      },
    });
    void announcePush({
      login: job.login,
      ok: true,
      repo: target.fullName,
      branch,
      sha: result.sha,
      files,
      bytes,
      filename: job.filename,
      at: Date.now(),
    });
  } catch (err) {
    // Log serveur sans token (le token n'apparaît jamais dans les erreurs).
    console.error(`[job ${jobId}] push failed:`, err);
    const message = toUserMessage(err);
    updateJob(jobId, { status: "failed", error: message });
    logEvent({
      kind: "push",
      login: job.login,
      detail: {
        ok: false,
        jobId,
        filename: job.filename,
        error: message.slice(0, 300),
      },
    });
    void announcePush({
      login: job.login,
      ok: false,
      filename: job.filename,
      error: message,
      at: Date.now(),
    });
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
