/**
 * Client minimal de l'API GitHub (REST v3).
 * Toutes les fonctions prennent le token de l'utilisateur en argument ;
 * ce token n'est jamais journalisé.
 */
import { AppError } from "./errors";
import { config } from "./config";

/** `fetch` injectable : les tests passent une fausse implémentation. */
export type FetchImpl = typeof fetch;

const HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "RepoDrop",
});

/**
 * Requête brute vers l'API GitHub, avec le même traitement d'erreur que `gh`.
 * Sert aux réponses qui ne sont pas du JSON (archives à streamer).
 */
export async function ghRaw(
  token: string,
  path: string,
  init: RequestInit = { method: "GET" },
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.github.apiUrl}${path}`, {
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
  return res;
}

export async function gh<T>(
  token: string,
  path: string,
  init: RequestInit = { method: "GET" },
  fetchImpl: FetchImpl = fetch,
): Promise<T> {
  const res = await ghRaw(token, path, init, fetchImpl);
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

/* ------------------------------------------------------------------ *
 * Navigation et gestion des dépôts (aperçu avant import + actions)
 * ------------------------------------------------------------------ */

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Valide un segment `owner` ou `repo` d'URL (pas d'injection de chemin). */
export function assertRepoName(value: string, kind: "owner" | "repo"): string {
  const v = (value ?? "").trim();
  if (!v || v.length > 100 || !NAME_RE.test(v)) {
    throw new AppError("NAME_INVALID", undefined, `${kind} invalide`);
  }
  return v;
}

/**
 * Normalise un chemin interne de dépôt pour l'API `contents`.
 * Refuse tout ce qui pourrait sortir du dépôt (`..`, chemin absolu, octet nul).
 * Renvoie `""` pour la racine.
 */
export function safeRepoPath(raw: string): string {
  const p = String(raw ?? "").replace(/\\/g, "/").trim();
  if (!p || p === "/" || p === ".") return "";
  if (p.includes("\0")) {
    throw new AppError("BAD_PATH", undefined, "octet nul dans le chemin");
  }
  if (p.startsWith("/")) {
    throw new AppError("BAD_PATH", undefined, "chemin absolu refusé");
  }
  const segments = p.split("/").filter((s) => s.length > 0);
  for (const s of segments) {
    if (s === "." || s === "..") {
      throw new AppError("BAD_PATH", undefined, `segment « ${s} » refusé`);
    }
    if (s.length > 255) {
      throw new AppError("BAD_PATH", undefined, "segment de chemin trop long");
    }
  }
  const joined = segments.join("/");
  if (joined.length > 1000) {
    throw new AppError("BAD_PATH", undefined, "chemin trop long");
  }
  return joined;
}

/** Nom de branche / tag / SHA, passé tel quel à `?ref=` après contrôle strict. */
export function safeRef(raw: string | null | undefined): string {
  const r = String(raw ?? "").trim();
  if (!r) return "";
  if (r.length > 255 || /[\s~^:?*[\]@{}\\]|\/\//.test(r)) {
    throw new AppError("NAME_INVALID", undefined, "référence de branche invalide");
  }
  return r;
}

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
  /** Ce que le jeton courant permet sur ce dépôt. */
  can: { pull: boolean; push: boolean; admin: boolean };
}

interface GhRepoFull {
  full_name: string;
  name: string;
  owner?: { login?: string };
  private?: boolean;
  archived?: boolean;
  fork?: boolean;
  default_branch?: string;
  pushed_at?: string | null;
  updated_at?: string | null;
  size?: number;
  description?: string | null;
  language?: string | null;
  html_url?: string;
  stargazers_count?: number;
  open_issues_count?: number;
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
}

function toSummary(r: GhRepoFull): RepoSummary {
  return {
    full_name: r.full_name,
    name: r.name,
    owner: r.owner?.login ?? r.full_name.split("/")[0] ?? "",
    private: r.private === true,
    archived: r.archived === true,
    fork: r.fork === true,
    default_branch: r.default_branch ?? "main",
    pushed_at: r.pushed_at ?? null,
    updated_at: r.updated_at ?? null,
    size: r.size ?? 0,
    description: r.description ?? null,
    language: r.language ?? null,
    html_url: r.html_url ?? `https://github.com/${r.full_name}`,
    stargazers_count: r.stargazers_count ?? 0,
    open_issues_count: r.open_issues_count ?? 0,
    can: {
      pull: r.permissions?.pull === true,
      push: r.permissions?.push === true,
      admin: r.permissions?.admin === true,
    },
  };
}

export interface RepoListResult {
  repos: RepoSummary[];
  /** true si le plafond de pages a été atteint (liste potentiellement tronquée). */
  truncated: boolean;
  /** Pages réellement lues. */
  pages: number;
}

/**
 * Dépôts visibles par le jeton (propriétaire + collaborateur), les plus
 * récemment mis à jour d'abord. `maxPages` borne le coût : 3 pages = 300 dépôts.
 */
export async function listRepos(
  token: string,
  opts: { maxPages?: number; perPage?: number; fetchImpl?: FetchImpl } = {},
): Promise<RepoListResult> {
  const maxPages = Math.max(1, Math.min(10, opts.maxPages ?? 3));
  const perPage = Math.max(1, Math.min(100, opts.perPage ?? 100));
  const out: RepoSummary[] = [];
  let page = 1;
  for (; page <= maxPages; page++) {
    const batch = await gh<GhRepoFull[]>(
      token,
      `/user/repos?affiliation=owner,collaborator&sort=updated&per_page=${perPage}&page=${page}`,
      { method: "GET" },
      opts.fetchImpl,
    );
    for (const r of batch) out.push(toSummary(r));
    if (batch.length < perPage) return { repos: out, truncated: false, pages: page };
  }
  return { repos: out, truncated: true, pages: maxPages };
}

/** Détails d'un dépôt (droits inclus). */
export async function getRepoInfo(
  token: string,
  owner: string,
  repo: string,
  fetchImpl?: FetchImpl,
): Promise<RepoSummary> {
  const o = assertRepoName(owner, "owner");
  const r = assertRepoName(repo, "repo");
  return toSummary(await gh<GhRepoFull>(token, `/repos/${o}/${r}`, { method: "GET" }, fetchImpl));
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
}

interface GhContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: string;
}

/**
 * Contenu d'un dossier (racine si `path` est vide), trié dossiers d'abord.
 * Un dépôt sans aucun commit renvoie une liste vide plutôt qu'une 404.
 */
export async function getTree(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  fetchImpl?: FetchImpl,
): Promise<{ entries: TreeEntry[]; empty: boolean }> {
  const o = assertRepoName(owner, "owner");
  const r = assertRepoName(repo, "repo");
  const p = safeRepoPath(path);
  const q = ref ? `?ref=${encodeURIComponent(safeRef(ref))}` : "";
  let items: GhContent[];
  try {
    items = await gh<GhContent[]>(
      token,
      `/repos/${o}/${r}/contents/${p.split("/").map(encodeURIComponent).join("/")}${q}`,
      { method: "GET" },
      fetchImpl,
    );
  } catch (e) {
    // Dépôt créé mais jamais commité : GitHub répond 404 « repository is empty ».
    if (e instanceof AppError && e.code === "NOT_FOUND" && p === "") {
      return { entries: [], empty: true };
    }
    throw e;
  }
  if (!Array.isArray(items)) {
    // Un fichier a été demandé à la place d'un dossier.
    throw new AppError("NOT_FOUND", undefined, "ce chemin n'est pas un dossier");
  }
  const entries = items.map((i) => ({
    name: i.name,
    path: i.path,
    type: (["file", "dir", "symlink", "submodule"].includes(i.type)
      ? i.type
      : "file") as TreeEntry["type"],
    size: i.size ?? 0,
    sha: i.sha ?? "",
  }));
  entries.sort((a, b) => {
    const da = a.type === "dir" ? 0 : 1;
    const db = b.type === "dir" ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
  });
  return { entries, empty: entries.length === 0 };
}

/** Taille maximale affichée dans l'aperçu de fichier. */
export const MAX_VIEW_BYTES = 512 * 1024;

/** Extensions reconnues, pour colorer l'aperçu côté client. */
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", md: "markdown", mdx: "markdown",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  php: "php", sh: "shell", bash: "shell", zsh: "shell",
  css: "css", scss: "scss", less: "less", html: "html", htm: "html",
  svg: "xml", xml: "xml", yml: "yaml", yaml: "yaml", toml: "toml",
  sql: "sql", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
  dockerfile: "dockerfile", env: "shell", gitignore: "shell", lock: "json",
};

export function languageOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANG_BY_EXT[ext] ?? "text";
}

export interface BlobView {
  path: string;
  size: number;
  /** true si le fichier dépasse MAX_VIEW_BYTES : rien n'est renvoyé. */
  tooBig: boolean;
  /** true si le contenu n'est pas du texte (aucun contenu renvoyé). */
  binary: boolean;
  /** Texte décodé (chaîne vide si tooBig ou binary). */
  content: string;
  /** Nombre de lignes, pour l'affichage. */
  lines: number;
  language: string;
  html_url: string;
  sha: string;
  ref: string;
}

/**
 * Contenu d'un fichier, décodé en UTF-8.
 * - trop gros (> MAX_VIEW_BYTES) : `tooBig`, aucun octet transféré ;
 * - non décodable en UTF-8 strict : `binary`, aucun octet transféré.
 * Le contenu n'est JAMAIS interprété comme du HTML côté client.
 */
export async function getBlob(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  fetchImpl?: FetchImpl,
): Promise<BlobView> {
  const o = assertRepoName(owner, "owner");
  const r = assertRepoName(repo, "repo");
  const p = safeRepoPath(path);
  if (!p) throw new AppError("NOT_FOUND", undefined, "chemin de fichier requis");
  const q = ref ? `?ref=${encodeURIComponent(safeRef(ref))}` : "";
  const data = await gh<
    GhContent & { content?: string; encoding?: string; download_url?: string | null }
  >(
    token,
    `/repos/${o}/${r}/contents/${p.split("/").map(encodeURIComponent).join("/")}${q}`,
    { method: "GET" },
    fetchImpl,
  );
  if (!data || typeof (data as { type?: string }).type === "undefined") {
    throw new AppError("NOT_FOUND", undefined, "fichier introuvable");
  }
  if ((data as { type?: string }).type === "dir") {
    throw new AppError("NOT_FOUND", undefined, "ce chemin est un dossier");
  }

  const size = data.size ?? 0;
  const base = {
    path: p,
    size,
    language: languageOf(p),
    html_url: `https://github.com/${o}/${r}/blob/${encodeURIComponent(ref || "HEAD")}/${p
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    sha: data.sha ?? "",
    ref: ref || "",
  };

  if (size > MAX_VIEW_BYTES) {
    return { ...base, tooBig: true, binary: false, content: "", lines: 0 };
  }

  const raw = typeof data.content === "string" ? data.content : "";
  if (!raw) {
    // GitHub ne renvoie pas le contenu au-delà de 1 Mo : on ne devine rien.
    return { ...base, tooBig: true, binary: false, content: "", lines: 0 };
  }

  const bytes = Buffer.from(raw, "base64");
  let text: string;
  try {
    // `fatal` : un octet invalide en UTF-8 lève, donc c'est du binaire.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ...base, tooBig: false, binary: true, content: "", lines: 0 };
  }
  if (text.includes("\0")) {
    return { ...base, tooBig: false, binary: true, content: "", lines: 0 };
  }
  return {
    ...base,
    tooBig: false,
    binary: false,
    content: text,
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

export interface Branch {
  name: string;
  protected: boolean;
}

export async function listBranches(
  token: string,
  owner: string,
  repo: string,
  fetchImpl?: FetchImpl,
): Promise<Branch[]> {
  const o = assertRepoName(owner, "owner");
  const r = assertRepoName(repo, "repo");
  const batch = await gh<{ name: string; protected?: boolean }[]>(
    token,
    `/repos/${o}/${r}/branches?per_page=100`,
    { method: "GET" },
    fetchImpl,
  );
  return (Array.isArray(batch) ? batch : []).map((b) => ({
    name: b.name,
    protected: b.protected === true,
  }));
}

export interface RepoPatch {
  name?: string;
  private?: boolean;
  description?: string | null;
}

/** Renomme un dépôt, change sa visibilité et/ou sa description. */
export async function updateRepo(
  token: string,
  owner: string,
  repo: string,
  patch: RepoPatch,
  fetchImpl?: FetchImpl,
): Promise<RepoSummary> {
  const o = assertRepoName(owner, "owner");
  const r = assertRepoName(repo, "repo");
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n || n.length > 100 || !NAME_RE.test(n)) {
      throw new AppError("NAME_INVALID", undefined, "nouveau nom de dépôt invalide");
    }
    body.name = n;
  }
  if (patch.private !== undefined) body.private = patch.private === true;
  if (patch.description !== undefined) {
    body.description =
      typeof patch.description === "string" ? patch.description.slice(0, 350) : null;
  }
  if (Object.keys(body).length === 0) {
    throw new AppError("NAME_INVALID", undefined, "aucune modification demandée");
  }
  return toSummary(
    await gh<GhRepoFull>(
      token,
      `/repos/${o}/${r}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      fetchImpl,
    ),
  );
}

/**
 * Supprime un dépôt. `confirm` doit reproduire exactement `owner/repo` :
 * la destruction est définitive et ne passe pas par la corbeille.
 */
export async function deleteRepo(
  token: string,
  owner: string,
  repo: string,
  confirm: string,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const o = assertRepoName(owner, "owner");
  const r = assertRepoName(repo, "repo");
  if (String(confirm ?? "").trim() !== `${o}/${r}`) {
    throw new AppError("CONFIRM_MISMATCH", undefined, `attendu : ${o}/${r}`);
  }
  try {
    await gh<void>(token, `/repos/${o}/${r}`, { method: "DELETE" }, fetchImpl);
  } catch (e) {
    // Sans le scope `delete_repo`, GitHub répond 404 (et non 403) pour ne pas
    // révéler l'existence du dépôt : on explique donc les deux causes.
    if (e instanceof AppError && e.code === "NOT_FOUND") {
      throw new AppError(
        "FORBIDDEN",
        undefined,
        "dépôt introuvable, ou jeton sans le scope « delete_repo » — reconnectez-vous",
      );
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ *
 * Archive d'un dépôt (.zip / .tar.gz)
 * ------------------------------------------------------------------ */

export type ArchiveFormat = "zip" | "tar.gz";

/**
 * Nom de fichier proposé au navigateur.
 *
 * Assaini : aucun séparateur ni caractère de contrôle ne peut sortir du
 * `Content-Disposition` (ni injecter d'en-tête), et les noms non ASCII passent
 * par `filename*` (RFC 5987).
 */
export function archiveFilename(
  repo: string,
  ref: string,
  format: ArchiveFormat,
): string {
  const clean = (value: string, fallback: string) =>
    value
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 80)
      .trim() || fallback;
  const ext = format === "zip" ? "zip" : "tar.gz";
  return `${clean(repo, "depot")}-${clean(ref, "repo")}.${ext}`;
}

export interface ArchiveStream {
  /** Flux brut : l'archive ne passe jamais entièrement en mémoire. */
  body: ReadableStream<Uint8Array>;
  contentType: string;
  /** Taille annoncée par le serveur, 0 si inconnue. */
  contentLength: number;
  filename: string;
}

/**
 * Récupère l'archive d'un dépôt depuis GitHub (`zipball` / `tarball`).
 *
 * GitHub répond par une redirection vers son CDN : `fetch` la suit, et le
 * corps est renvoyé tel quel pour être streamé au navigateur. La taille est
 * contrôlée AVANT de transférer quoi que ce soit.
 */
export async function streamArchive(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  format: ArchiveFormat,
  fetchImpl: FetchImpl = fetch,
): Promise<ArchiveStream> {
  const o = assertRepoName(owner, "owner");
  const r = assertRepoName(repo, "repo");
  const branch = safeRef(ref);
  const endpoint = format === "zip" ? "zipball" : "tarball";
  const suffix = branch ? `/${encodeURIComponent(branch)}` : "";

  let res: Response;
  try {
    res = await ghRaw(token, `/repos/${o}/${r}/${endpoint}${suffix}`, { method: "GET" }, fetchImpl);
  } catch (e) {
    // Dépôt sans aucun commit, ou branche inexistante : GitHub répond 404.
    if (e instanceof AppError && e.code === "NOT_FOUND") {
      throw new AppError(
        "NOT_FOUND",
        undefined,
        "dépôt vide ou référence inconnue : aucune archive à produire",
      );
    }
    throw e;
  }

  if (!res.body) {
    throw new AppError("INTERNAL", undefined, "réponse de GitHub sans corps");
  }

  const contentLength = Number(res.headers.get("content-length") ?? 0) || 0;
  if (contentLength > config.limits.maxArchiveBytes) {
    throw new AppError(
      "ARCHIVE_TOO_BIG",
      undefined,
      `archive annoncée à ${Math.round(contentLength / 1048576)} Mo, plafond ${Math.round(
        config.limits.maxArchiveBytes / 1048576,
      )} Mo`,
    );
  }

  return {
    body: res.body,
    contentType: format === "zip" ? "application/zip" : "application/gzip",
    contentLength,
    filename: archiveFilename(r, branch, format),
  };
}
