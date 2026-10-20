/**
 * Types partagés entre les routes API et les composants client du navigateur
 * de dépôts.
 *
 * Ils sont volontairement séparés de `lib/github.ts` : ce module importe
 * `lib/config`, qui charge `node:crypto` — impossible dans un composant client.
 * Même raison d'être que `lib/staff-types.ts`.
 */

export interface RepoSummary {
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  pushed_at: string | null;
  updated_at: string | null;
  /** Ko, tel que renvoyé par GitHub. */
  size: number;
  description: string | null;
  language: string | null;
  html_url: string;
  stargazers_count: number;
  open_issues_count: number;
  can: { pull: boolean; push: boolean; admin: boolean };
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
}

export interface BlobView {
  path: string;
  size: number;
  tooBig: boolean;
  binary: boolean;
  content: string;
  lines: number;
  language: string;
  html_url: string;
  sha: string;
  ref: string;
}

export interface Branch {
  name: string;
  protected: boolean;
}

/** Réponses des routes /api/repos*. */
export interface RepoListResponse {
  repos: RepoSummary[];
  truncated: boolean;
  pages: number;
}

export interface TreeResponse {
  path: string;
  ref: string;
  entries: TreeEntry[];
  empty: boolean;
}

/** Ordres de tri proposés dans la liste des dépôts. */
export type RepoSort = "pushed" | "name" | "size";

export const REPO_SORTS: { id: RepoSort; label: string }[] = [
  { id: "pushed", label: "Activité récente" },
  { id: "name", label: "Nom (A→Z)" },
  { id: "size", label: "Taille" },
];
