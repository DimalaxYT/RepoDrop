/**
 * Opérations git locales (init / fetch superficiel / overlay / commit / push)
 * vers GitHub.
 *
 * Sécurité du token :
 *  - jamais dans les args de process (donc jamais visible dans `ps`) ;
 *  - jamais dans l'URL du remote ;
 *  - transmis via GIT_ASKPASS (script éphémère) + variable d'env dédiée,
 *    le tout isolé dans le dossier du job (HOME de travail du git enfant).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "./errors";

const ASKPASS_SCRIPT = `#!/bin/sh
# Répond aux prompts git : utilisateur fixe, mot de passe = jeton (env).
case "$1" in
  *[Uu]sername*) printf 'x-access-token\\n' ;;
  *) printf '%s\\n' "$GIT_PUSH_TOKEN" ;;
esac
`;

function cleanOutput(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\[[0-9;]*m/g, "") // ANSI
    .trim()
    .slice(0, 400);
}

interface GitOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function gitEnv(jobDir: string, token: string): NodeJS.ProcessEnv {
  const askpass = path.join(jobDir, "askpass.sh");
  fs.writeFileSync(askpass, ASKPASS_SCRIPT, { mode: 0o700 });
  return {
    ...process.env,
    // Isolation totale : pas de ~/.gitconfig global, pas de helpers distants.
    HOME: jobDir,
    XDG_CONFIG_HOME: path.join(jobDir, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: askpass,
    SSH_ASKPASS: askpass,
    GIT_PUSH_TOKEN: token,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
  };
}

async function git(args: string[], opts: GitOpts): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }
        const detail = cleanOutput(String(stderr || stdout));
        // Jamais de token dans ces messages : l'auth passe par l'env.
        if (/non-fast-forward|\[rejected\]|failed to push/i.test(detail)) {
          reject(new AppError("CONFLICT", undefined, detail));
        } else if (/Repository not found/i.test(detail)) {
          reject(new AppError("FORBIDDEN", undefined, detail));
        } else if (/Permission denied|denied/i.test(detail)) {
          reject(new AppError("FORBIDDEN", undefined, detail));
        } else if ((err as { killed?: boolean }).killed) {
          reject(new AppError("GIT_FAILED", undefined, "délai dépassé"));
        } else {
          reject(new AppError("GIT_FAILED", undefined, detail));
        }
      },
    );
  });
}

export interface PushTarget {
  /** "owner/repo" */
  fullName: string;
  /** true = dépôt vierge (créé par nous ou vide) → pas de fetch */
  isEmpty: boolean;
  /** branche par défaut du dépôt (si non vide) */
  defaultBranch: string;
}

export interface PushRun {
  jobDir: string;
  /** Dossier source (contenu extrait, racine unique éventuellement retirée) */
  srcDir: string;
  token: string;
  target: PushTarget;
  /** Branche à créer/mettre à jour */
  branch: string;
  commitMessage: string;
  authorLogin: string;
  /** false = exclure node_modules lors de la copie */
  includeNodeModules: boolean;
  /** Override test : URL du remote (défaut : https://github.com/<full>.git) */
  remoteUrl?: string;
}

/** Copie récursive du contenu de `src` vers `dest` (merge/overwrite). */
async function overlayCopy(
  src: string,
  dest: string,
  includeNodeModules: boolean,
): Promise<void> {
  const items = await fs.promises.readdir(src, { withFileTypes: true });
  for (const item of items) {
    const from = path.join(src, item.name);
    const to = path.join(dest, item.name);
    if (!includeNodeModules && item.name === "node_modules") continue;
    if (item.isDirectory()) {
      await overlayCopy(from, to, includeNodeModules);
    } else if (item.isFile()) {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      try {
        // Hardlink (même fs /tmp) : rapide et sans double espace disque.
        await fs.promises.link(from, to);
      } catch {
        await fs.promises.copyFile(from, to);
      }
    }
    // symlink : jamais présent (l'extractor les écarte) — ignoré par sécurité.
  }
}

/**
 * Exécute l'intégralité du flux git pour un job.
 * Lance une AppError traduite en FR par le caller (jobs.ts).
 */
export async function runGitPush(run: PushRun): Promise<{ sha: string; url: string }> {
  const workDir = path.join(run.jobDir, "work");
  await fs.promises.rm(workDir, { recursive: true, force: true });
  await fs.promises.mkdir(workDir, { recursive: true });

  const env = gitEnv(run.jobDir, run.token);
  const g = (args: string[], timeoutMs?: number) =>
    git(args, { cwd: workDir, env, timeoutMs });

  // 1. Repository local vierge, branche cible directement.
  await g(["init", "-q", "-b", run.branch]);
  await g(["config", "user.name", run.authorLogin]);
  await g(["config", "user.email", `${run.authorLogin}@users.noreply.github.com`]);
  await g(["config", "commit.gpgsign", "false"]);

  // 2. Remote TOUJOURS configuré ; dépôt existant non vide → fetch superficiel
  //    pour partir de l'état courant.
  const remoteUrl = run.remoteUrl ?? `https://github.com/${run.target.fullName}.git`;
  await g(["remote", "add", "origin", remoteUrl]);
  if (!run.target.isEmpty) {
    await g(["fetch", "-q", "--depth", "1", "origin", run.target.defaultBranch], 180_000);
    // Détache sur FETCH_HEAD pour partir de l'état courant du dépôt,
    // tout en nommant la branche locale selon la branche cible.
    await g(["checkout", "-q", "-B", run.branch, "FETCH_HEAD"]);
  }

  // 3. Superposition des fichiers de l'archive (les fichiers existants qui ne
  //    sont pas dans l'archive sont conservés ; conflits = l'archive gagne).
  await overlayCopy(run.srcDir, workDir, run.includeNodeModules);

  // 4. Rien à pousser ?
  const status = await g(["status", "--porcelain"]);
  if (status.trim() === "") {
    throw new AppError("NO_CHANGES");
  }

  // 5. Commit.
  await g(["add", "-A"]);
  await g(["commit", "-q", "-m", run.commitMessage], 60_000);

  // 6. Push (création de la branche distante si nécessaire).
  await g(["push", "-q", "-u", "origin", `HEAD:${run.branch}`], 180_000);

  const sha = (await g(["rev-parse", "HEAD"])).trim();
  return { sha, url: `https://github.com/${run.target.fullName}` };
}
