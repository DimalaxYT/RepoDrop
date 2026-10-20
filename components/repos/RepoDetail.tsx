"use client";

/**
 * Détail d'un dépôt : arborescence navigable, aperçu des fichiers, sélecteur de
 * branche et actions rapides.
 *
 * Tout est chargé à la demande (un dossier = une requête, un fichier = une
 * requête). Le contenu d'un fichier est affiché comme du texte brut dans un
 * <pre> : jamais injecté en HTML, donc pas de XSS via un README ou un SVG.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  File as FileIcon,
  FileCode,
  FileText,
  Folder,
  GitBranch,
  Link2,
  Loader2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RepoActions } from "./RepoActions";
import { cn, formatBytes, timeAgo } from "@/lib/utils";
import type { BlobView, Branch, RepoSummary, TreeEntry } from "@/lib/repo-types";

/** Icône selon l'extension, pour repérer vite le type de fichier. */
function iconFor(name: string) {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "php", "c", "cpp", "cs", "sh"].includes(ext)) {
    return <FileCode className="h-4 w-4 shrink-0 text-sky/80" />;
  }
  if (["md", "txt", "rst", "adoc"].includes(ext)) {
    return <FileText className="h-4 w-4 shrink-0 text-go/80" />;
  }
  return <FileIcon className="h-4 w-4 shrink-0 text-mist" />;
}

export function RepoDetail({
  fullName,
  onBack,
  onChanged,
  onDeleted,
}: {
  fullName: string;
  onBack: () => void;
  /** Le dépôt a été renommé / modifié : la liste doit se rafraîchir. */
  onChanged: (next: RepoSummary) => void;
  onDeleted: (fullName: string) => void;
}) {
  const [owner, name] = fullName.split("/");
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [ref, setRef] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [empty, setEmpty] = useState(false);
  const [file, setFile] = useState<BlobView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);

  /** Charge le dépôt + ses branches, une seule fois par dépôt. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setEntries(null);
    setFile(null);
    setPath("");
    setBranches([]);
    setRepo(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          repo?: RepoSummary;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.repo) {
          setError(data.error ?? `Dépôt inaccessible (HTTP ${res.status}).`);
          setLoading(false);
          return;
        }
        setRepo(data.repo);
        setRef(data.repo.default_branch);

        const br = await fetch(
          `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
          { cache: "no-store" },
        );
        const brData = (await br.json().catch(() => ({}))) as { branches?: Branch[] };
        if (!cancelled && br.ok) setBranches(brData.branches ?? []);
      } catch {
        if (!cancelled) setError("Impossible de joindre le serveur.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  /** Charge le dossier courant. */
  const loadTree = useCallback(
    async (nextPath: string, nextRef: string) => {
      setLoading(true);
      setError("");
      setFile(null);
      try {
        const qs = new URLSearchParams();
        if (nextPath) qs.set("path", nextPath);
        if (nextRef) qs.set("ref", nextRef);
        const res = await fetch(
          `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree?${qs}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          entries?: TreeEntry[];
          empty?: boolean;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? `Dossier illisible (HTTP ${res.status}).`);
          setEntries(null);
          return;
        }
        setEntries(data.entries ?? []);
        setEmpty(data.empty === true);
      } catch {
        setError("Impossible de joindre le serveur.");
      } finally {
        setLoading(false);
      }
    },
    [owner, name],
  );

  // Recharge le dossier dès qu'on navigue, qu'on change de branche, ou que le
  // dépôt vient d'être modifié (un renommage change l'identité de `repo`).
  useEffect(() => {
    if (repo) void loadTree(path, ref);
  }, [repo, path, ref, loadTree]);

  /** Ouvre un fichier. */
  async function openFile(entry: TreeEntry) {
    setFileLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ path: entry.path });
      if (ref) qs.set("ref", ref);
      const res = await fetch(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob?${qs}`,
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        blob?: BlobView;
        error?: string;
      };
      if (!res.ok || !data.blob) {
        setError(data.error ?? `Fichier illisible (HTTP ${res.status}).`);
        return;
      }
      setFile(data.blob);
    } catch {
      setError("Impossible de joindre le serveur.");
    } finally {
      setFileLoading(false);
    }
  }

  async function copyContent() {
    if (!file?.content) return;
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copie refusée par le navigateur.");
    }
  }

  const crumbs = path ? path.split("/") : [];

  if (loading && !repo) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-panel p-8 text-sm text-mist ring-1 ring-edge">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement du dépôt…
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="rounded-2xl bg-panel p-6 ring-1 ring-edge">
        <p className="text-sm text-danger">{error || "Dépôt inaccessible."}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------------- en-tête */}
      <div className="rounded-2xl bg-panel p-4 shadow-panel ring-1 ring-edge sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
                Liste
              </Button>
              <h2 className="truncate text-lg font-semibold tracking-tight">
                <span className="text-mist">{repo.owner}/</span>
                {repo.name}
              </h2>
            </div>
            {repo.description && (
              <p className="mt-2 text-sm text-mist">{repo.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-mist">
              <Badge variant={repo.private ? "muted" : "sky"}>
                {repo.private ? "privé" : "public"}
              </Badge>
              {repo.language && <Badge variant="muted">{repo.language}</Badge>}
              {repo.archived && <Badge variant="amber">archivé</Badge>}
              {repo.fork && <Badge variant="muted">fork</Badge>}
              <span>{formatBytes(repo.size * 1024)}</span>
              {repo.pushed_at && (
                <span>· poussé {timeAgo(new Date(repo.pushed_at).getTime())}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {branches.length > 0 && (
              <label className="flex items-center gap-1.5 rounded-lg bg-panel2 px-2.5 py-1.5 text-xs ring-1 ring-edge">
                <GitBranch className="h-3.5 w-3.5 text-go" />
                <select
                  value={ref}
                  onChange={(e) => {
                    setRef(e.target.value);
                    setPath("");
                  }}
                  className="max-w-[12rem] truncate bg-transparent text-chalk outline-none"
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name} className="bg-panel">
                      {b.name}
                      {b.protected ? " (protégée)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <a
              href={repo.html_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-mist ring-1 ring-edge transition-colors hover:text-chalk"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub
            </a>
            <Button
              variant={showActions ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowActions((v) => !v)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Actions
            </Button>
          </div>
        </div>

        {showActions && (
          <div className="mt-4 border-t border-edge/60 pt-4">
            <RepoActions
              repo={repo}
              onUpdated={(next) => {
                setRepo(next);
                onChanged(next);
              }}
              onDeleted={onDeleted}
            />
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger ring-1 ring-danger/30">
          {error}
        </p>
      )}

      {/* ------------------------------------------------- fil d'ariane */}
      <nav className="flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => setPath("")}
          className={cn(
            "rounded px-1.5 py-1 transition-colors hover:bg-panel2",
            path ? "text-go" : "text-chalk",
          )}
        >
          {repo.name}
        </button>
        {crumbs.map((c, i) => {
          const target = crumbs.slice(0, i + 1).join("/");
          const last = i === crumbs.length - 1;
          return (
            <span key={target} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-mist/60" />
              <button
                type="button"
                onClick={() => setPath(target)}
                disabled={last}
                className={cn(
                  "rounded px-1.5 py-1 transition-colors",
                  last ? "text-chalk" : "text-go hover:bg-panel2",
                )}
              >
                {c}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => void loadTree(path, ref)}
          className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-1 text-mist transition-colors hover:bg-panel2 hover:text-chalk"
          title="Recharger ce dossier"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </nav>

      {/* -------------------------------------------------------- contenu */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ------------------------------------------------ arborescence */}
        <section className="overflow-hidden rounded-2xl bg-panel ring-1 ring-edge">
          <header className="flex items-center justify-between gap-2 border-b border-edge/60 px-4 py-2.5 text-xs text-mist">
            <span className="flex items-center gap-2">
              <Folder className="h-3.5 w-3.5 text-go/80" />
              {path || "racine"}
            </span>
            <span>{entries ? `${entries.length} entrée(s)` : "…"}</span>
          </header>

          {loading ? (
            <p className="flex items-center gap-2 px-4 py-8 text-sm text-mist">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </p>
          ) : empty && !file ? (
            <p className="px-4 py-8 text-sm text-mist">
              Ce dépôt ne contient encore aucun fichier. Importez une archive
              pour le remplir.
            </p>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-edge/40 overflow-y-auto">
              {(entries ?? []).map((entry) => {
                const isDir = entry.type === "dir";
                const active = file?.path === entry.path;
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => (isDir ? setPath(entry.path) : void openFile(entry))}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors",
                        active ? "bg-go/10 text-chalk" : "text-mist hover:bg-panel2 hover:text-chalk",
                      )}
                    >
                      {isDir ? (
                        <Folder className="h-4 w-4 shrink-0 text-go/80" />
                      ) : (
                        iconFor(entry.name)
                      )}
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-mist/70">
                        {isDir ? "" : formatBytes(entry.size)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------ aperçu */}
        <section className="overflow-hidden rounded-2xl bg-panel ring-1 ring-edge">
          {!file ? (
            <p className="px-4 py-10 text-center text-sm text-mist">
              {fileLoading
                ? "Chargement du fichier…"
                : "Sélectionnez un fichier pour l'apercevoir."}
            </p>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/60 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-chalk">{file.path}</p>
                  <p className="mt-0.5 text-[11px] text-mist">
                    {formatBytes(file.size)}
                    {file.lines > 0 ? ` · ${file.lines} lignes` : ""}
                    {file.language !== "text" ? ` · ${file.language}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {!file.tooBig && !file.binary && (
                    <Button variant="ghost" size="sm" onClick={() => void copyContent()}>
                      {copied ? (
                        <Link2 className="h-3.5 w-3.5 text-go" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? "Copié" : "Copier"}
                    </Button>
                  )}
                  <a
                    href={file.html_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-mist ring-1 ring-edge transition-colors hover:text-chalk"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Brut
                  </a>
                </div>
              </header>

              {file.tooBig ? (
                <p className="px-4 py-10 text-center text-sm text-mist">
                  Fichier trop volumineux pour l'aperçu ({formatBytes(file.size)}).
                  Ouvrez-le sur GitHub.
                </p>
              ) : file.binary ? (
                <p className="px-4 py-10 text-center text-sm text-mist">
                  Fichier binaire ({formatBytes(file.size)}) : aucun aperçu texte.
                </p>
              ) : (
                <pre className="max-h-[32rem] overflow-auto bg-ink/60 p-4 font-mono text-[11.5px] leading-relaxed text-chalk/90">
                  <code>{file.content}</code>
                </pre>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
