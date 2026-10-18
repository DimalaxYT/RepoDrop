/**
 * Client minimal de l'API GitHub (REST v3).
 * Toutes les fonctions prennent le token de l'utilisateur en argument ;
 * ce token n'est jamais journalisé.
 */
import { AppError } from "./errors";

const API = "https://api.github.com";

const HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "RepoDrop",
});

async function gh<T>(
  token: string,
  path: string,
  init: RequestInit = { method: "GET" },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...HEADERS(token), ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new AppError("INTERNAL", undefined, "API GitHub injoignable");
  }
  if (res.status === 401) throw new AppError("FORBIDDEN", undefined, "401 token invalide");
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString("fr-FR") : "";
    throw new AppError(
      "RATE_LIMITED",
      undefined,
      `quota API GitHub atteint${when ? ` (reset ~${when})` : ""}`,
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { message?: string; errors?: { code?: string }[] }
      | null;
    if (res.status === 404) throw new AppError("NOT_FOUND", undefined, body?.message);
    if (res.status === 422 && body?.errors?.some((e) => e.code === "already_exists")) {
      throw new AppError("REPO_EXISTS", undefined, body.message);
    }
    if (res.status === 422) throw new AppError("NAME_INVALID", undefined, body?.message);
    if (res.status === 403) throw new AppError("FORBIDDEN", undefined, body?.message);
    throw new AppError("INTERNAL", undefined, `GitHub ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Viewer {
  login: string;
  name: string | null;
  avatar_url: string;
}

export async function getViewer(token: string): Promise<Viewer> {
  return gh<Viewer>(token, "/user");
}

export interface PushableRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  /** ~0 = dépôt vide */
  size: number;
  fork: boolean;
}

interface GhRepo extends PushableRepo {
  permissions?: { push?: boolean };
}

/** Dépôts où l'utilisateur peut pousser (owner + collaborateur), triés par récence. */
export async function listPushableRepos(token: string): Promise<PushableRepo[]> {
  const out: PushableRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await gh<GhRepo[]>(
      token,
      `/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100&page=${page}`,
    );
    for (const r of batch) {
      if (r.permissions?.push) {
        out.push({
          full_name: r.full_name,
          private: r.private,
          default_branch: r.default_branch,
          pushed_at: r.pushed_at,
          size: r.size,
          fork: r.fork,
        });
      }
    }
    if (batch.length < 100) break;
  }
  return out;
}

export interface CreatedRepo {
  full_name: string;
  default_branch: string;
  html_url: string;
  private: boolean;
}

export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<CreatedRepo> {
  return gh<CreatedRepo>(token, "/user/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, private: isPrivate, description: "", auto_init: false }),
  });
}

export async function getRepo(
  token: string,
  fullName: string,
): Promise<{ full_name: string; default_branch: string; size: number; private: boolean; permissions?: { push?: boolean } }> {
  return gh(token, `/repos/${fullName}`);
}

export async function branchExists(
  token: string,
  fullName: string,
  branch: string,
): Promise<boolean> {
  try {
    await gh(token, `/repos/${fullName}/branches/${encodeURIComponent(branch)}`);
    return true;
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") return false;
    throw e;
  }
}
