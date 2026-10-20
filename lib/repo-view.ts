/**
 * État de navigation de `/repos`, sérialisé dans l'URL.
 *
 * La sélection, le dossier, le fichier, la branche, le filtre et le tri vivaient
 * auparavant uniquement dans des `useState`. Un rafraîchissement, un retour
 * arrière ou un lien partagé ramenait donc à la liste et perdait le contexte.
 *
 * La logique est isolée ici, hors du composant, parce qu'elle est **pure** :
 * on peut la tester sans DOM ni React. Le composant ne fait que lire et écrire
 * ces valeurs.
 */
import { REPO_SORTS, type RepoSort } from "./repo-types";

export interface RepoView {
  /** `full_name` du dépôt consulté (`owner/repo`), ou "" pour la liste. */
  repo: string;
  /** Filtre textuel. */
  query: string;
  sort: RepoSort;
  /** N'afficher que les dépôts dont le visiteur est propriétaire. */
  onlyMine: boolean;
  /** Branche (ou tag/SHA) consultée ; vide = branche par défaut du dépôt. */
  ref: string;
  /** Dossier courant dans l'arborescence ; vide = racine. */
  path: string;
  /** Fichier affiché dans l'aperçu ; vide = aucun fichier sélectionné. */
  file: string;
}

export const DEFAULT_REPO_VIEW: RepoView = {
  repo: "",
  query: "",
  sort: "pushed",
  onlyMine: false,
  ref: "",
  path: "",
  file: "",
};

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SORT_IDS = new Set<string>(REPO_SORTS.map((s) => s.id));

/**
 * Un `full_name` GitHub est `owner/repo`. Chaque segment commence par un
 * caractère alphanumérique, ce qui écarte `.`, `..` et les remontées de chemin.
 */
function isValidFullName(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((p) => SEGMENT_RE.test(p));
}

/** Validation de branche compatible avec `safeRef` côté serveur. */
function isValidRef(value: string): boolean {
  return (
    value.length <= 255 &&
    !/[\s~^:?*[\]@{}\\]/.test(value) &&
    !value.includes("//")
  );
}

/**
 * Chemin GitHub non absolu, sans segment vide, `.` ou `..`, caractères de
 * contrôle ou antislash. Accepte espaces, Unicode et ponctuation des noms de
 * fichiers ; le serveur encode ensuite chaque segment pour l'API GitHub.
 */
function isValidRepoPath(value: string): boolean {
  if (!value) return true;
  if (value.length > 1000 || value.startsWith("/") || value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((p) => p.length > 0 && p.length <= 255 && p !== "." && p !== "..");
}

/** Lit l'état depuis une query string, en ignorant toute valeur invalide. */
export function parseRepoView(params: URLSearchParams): RepoView {
  const rawRepo = params.get("repo") ?? "";
  const repo = isValidFullName(rawRepo) ? rawRepo : "";
  const sortRaw = params.get("sort") ?? "";
  const rawRef = params.get("ref") ?? "";
  const rawPath = params.get("path") ?? "";
  const rawFile = params.get("file") ?? "";
  const ref = isValidRef(rawRef) ? rawRef : "";
  const path = isValidRepoPath(rawPath) ? rawPath : "";
  const file = isValidRepoPath(rawFile) ? rawFile : "";

  return {
    // Un dépôt invalide annule aussi ses sous-états de navigation.
    repo,
    query: (params.get("q") ?? "").slice(0, 500),
    // Une valeur inconnue retombe sur le tri par défaut plutôt que de casser
    // l'affichage (lien ancien, paramètre tapé à la main).
    sort: SORT_IDS.has(sortRaw) ? (sortRaw as RepoSort) : DEFAULT_REPO_VIEW.sort,
    // Seul « 1 » compte comme vrai : `?mine=` ou `?mine=oui` restent faux.
    onlyMine: (params.get("mine") ?? "") === "1",
    ref: repo ? ref : "",
    path: repo ? path : "",
    file: repo ? file : "",
  };
}

/**
 * Sérialise l'état en query string, sans valeurs par défaut : une URL propre
 * (`/repos`) vaut mieux que `/repos?sort=pushed&q=&mine=0`.
 *
 * Le `?` initial est inclus, ou "" si rien n'est à porter.
 */
export function serializeRepoView(view: RepoView): string {
  const params = new URLSearchParams();
  if (view.repo) params.set("repo", view.repo);
  if (view.query) params.set("q", view.query);
  if (view.sort !== DEFAULT_REPO_VIEW.sort) params.set("sort", view.sort);
  if (view.onlyMine) params.set("mine", "1");
  if (view.repo && view.ref) params.set("ref", view.ref);
  if (view.repo && view.path) params.set("path", view.path);
  if (view.repo && view.file) params.set("file", view.file);

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** true si l'état correspond exactement à l'état par défaut. */
export function isDefaultRepoView(view: RepoView): boolean {
  return serializeRepoView(view) === "";
}
