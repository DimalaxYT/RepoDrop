/**
 * Liens « prêts à l'emploi » autour d'un dépôt poussé.
 *
 * But : permettre de donner à un assistant de code (ou à un humain) un simple
 * lien qui ouvre le dépôt dans un éditeur en ligne — Codespaces, vscode.dev —
 * avec l'agent IA déjà connecté à l'identité GitHub de l'utilisateur.
 *
 * Toutes les URL sont construites ici (source de vérité unique) et non dans
 * le composant : elles sont testables et restent cohérentes.
 */
import type { JobRecord } from "./types";

export interface RepoLinks {
  /** "owner/repo" */
  fullName: string;
  /** Page du dépôt sur GitHub */
  repoUrl: string;
  /** Page de la branche poussée */
  branchUrl: string;
  /** Page du commit poussé (null si inconnu) */
  commitUrl: string | null;
  /** Code cloud avec agent IA (GitHub Codespaces) */
  codespacesUrl: string;
  /** vscode.dev (éditeur web officiel, agent Copilot) */
  vscodeUrl: string;
  /** URL de clonage (sans jeton : l'agent s'authentifie lui-même) */
  cloneUrl: string;
  /** Commande de clone pour la CLI `gh` (session déjà authentifiée) */
  cloneCommand: string;
  /** Nom de fichier proposé pour l'archive .zip */
  zipName: string;
}

/** Encode un chemin GitHub en conservant les "/" (branches du type "feat/x"). */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** Nettoie un nom de fichier (aucun chemin, caractères sûrs). */
export function safeFileName(name: string, fallback = "archive"): string {
  const cleaned = name
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

/** "owner/repo" à partir du résultat de push (champ dédié ou URL). */
export function repoFullName(push: NonNullable<JobRecord["push"]>): string {
  if (push.fullName) return push.fullName;
  return push.url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "");
}

/** Construit l'ensemble des liens autour du dépôt poussé. */
export function buildRepoLinks(push: NonNullable<JobRecord["push"]>): RepoLinks {
  const fullName = repoFullName(push);
  const repoUrl = `https://github.com/${fullName}`;
  const branch = push.branch || "main";
  const branchUrl = `${repoUrl}/tree/${encodePath(branch)}`;
  const commitUrl = push.commitSha ? `${repoUrl}/commit/${push.commitSha}` : null;
  const params = new URLSearchParams({
    quickstart: "1",
    repo: fullName,
    ref: branch,
  });

  return {
    fullName,
    repoUrl,
    branchUrl,
    commitUrl,
    codespacesUrl: `https://github.com/codespaces/new?${params.toString()}`,
    vscodeUrl: `https://vscode.dev/github/${fullName}`,
    cloneUrl: `https://github.com/${fullName}.git`,
    cloneCommand: `gh repo clone ${fullName}`,
    zipName: `${safeFileName(fullName.replace("/", "-"))}-${safeFileName(branch)}.zip`,
  };
}
