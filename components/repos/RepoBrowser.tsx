"use client";

/**
 * Navigateur de dépôts : liste, recherche, tri, puis aperçu du contenu et
 * actions rapides.
 *
 * La liste vient de `/api/repos` (propriétaire + collaborateur, 300 dépôts au
 * plus). La recherche et le tri sont faits côté client sur ce jeu déjà chargé :
 * aucune requête supplémentaire, donc aucune consommation de quota GitHub en
 * tapant dans le champ de recherche.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  FolderArchive,
  GitFork,
  Lock,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RepoDetail } from "./RepoDetail";
import { cn, formatBytes, timeAgo } from "@/lib/utils";
import {
  REPO_SORTS,
  type RepoListResponse,
  type RepoSort,
  type RepoSummary,
} from "@/lib/repo-types";
import { parseRepoView, serializeRepoView, type RepoView } from "@/lib/repo-view";

export function RepoBrowser({ login }: { login: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /**
   * Filtre, tri et dépôt consulté vivent dans l'URL (`?repo=&q=&sort=&mine=`).
   *
   * Auparavant c'étaient de simples `useState` : un rafraîchissement, un retour
   * arrière ou un lien partagé ramenaient à la liste, en perdant le dépôt en
   * cours de consultation.
   */
  const view = useMemo(
    () => parseRepoView(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const { query, sort, onlyMine } = view;
  const selected = view.repo;

  /**
   * Écrit l'état dans l'URL. `push` uniquement pour l'ouverture d'un dépôt, afin
   * que le bouton retour du navigateur revienne à la liste ; le reste est un
   * `replace`, pour ne pas saturer l'historique à chaque frappe.
   */
  const update = (patch: Partial<RepoView>, push = false) => {
    const href = `/repos${serializeRepoView({ ...view, ...patch })}`;
    if (push) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  };
  // Stable pour RepoDetail : le chargement du dépôt ne doit pas redémarrer à
  // chaque mise à jour de l'URL (dossier/fichier/branche).
  const updateRef = useRef(update);
  updateRef.current = update;
  const handleViewChange = useCallback(
    (patch: Partial<RepoView>, push = false) => updateRef.current(patch, push),
    [],
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/repos", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as
        | (Partial<RepoListResponse> & { error?: string })
        | undefined;
      if (!res.ok || !data?.repos) {
        setError(data?.error ?? `Liste indisponible (HTTP ${res.status}).`);
        setRepos(null);
        return;
      }
      setRepos(data.repos);
      setTruncated(data.truncated === true);
    } catch {
      setError("Impossible de joindre le serveur.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = (repos ?? []).filter((r) => {
      // « Les miens » = dépôts dont le login connecté est propriétaire
      // (exclut ceux où il n'est que collaborateur).
      if (onlyMine && r.owner.toLowerCase() !== login.toLowerCase()) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.language ?? "").toLowerCase().includes(q)
      );
    });
    const byName = (a: RepoSummary, b: RepoSummary) =>
      a.full_name.localeCompare(b.full_name, "fr", { sensitivity: "base" });
    if (sort === "name") return out.sort(byName);
    if (sort === "size") return out.sort((a, b) => b.size - a.size || byName(a, b));
    return out.sort(
      (a, b) =>
        new Date(b.pushed_at ?? b.updated_at ?? 0).getTime() -
          new Date(a.pushed_at ?? a.updated_at ?? 0).getTime() || byName(a, b),
    );
  }, [repos, query, sort, onlyMine, login]);

  if (selected) {
    return (
      <RepoDetail
        fullName={selected}
        view={view}
        onViewChange={handleViewChange}
        onBack={() => update({ repo: "", ref: "", path: "", file: "" })}
        onChanged={(next) => {
          setRepos((prev) =>
            (prev ?? []).map((r) =>
              r.full_name === selected || r.full_name === next.full_name ? next : r,
            ),
          );
          update({ repo: next.full_name, ref: "", path: "", file: "" });
        }}
        onDeleted={(fullName) => {
          setRepos((prev) => (prev ?? []).filter((r) => r.full_name !== fullName));
          update({ repo: "", ref: "", path: "", file: "" });
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------- barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" />
          <Input
            value={query}
            onChange={(e) => update({ query: e.target.value })}
            placeholder="Filtrer par nom, description ou langage…"
            className="pl-9"
            aria-label="Filtrer les dépôts"
          />
        </label>

        <select
          value={sort}
          onChange={(e) => update({ sort: e.target.value as RepoSort })}
          aria-label="Trier"
          className="h-10 rounded-lg bg-panel2 px-3 text-sm text-chalk ring-1 ring-edge outline-none focus-visible:ring-2 focus-visible:ring-go/50"
        >
          {REPO_SORTS.map((s) => (
            <option key={s.id} value={s.id} className="bg-panel">
              {s.label}
            </option>
          ))}
        </select>

        <Button
          variant={onlyMine ? "secondary" : "outline"}
          onClick={() => update({ onlyMine: !onlyMine })}
        >
          <Lock className="h-4 w-4" />
          Les miens
        </Button>

        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Actualiser
        </Button>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger ring-1 ring-danger/30">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}

      {truncated && (
        <p className="flex items-center gap-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber ring-1 ring-amber/30">
          <AlertTriangle className="h-3.5 w-3.5" />
          Seuls les 300 dépôts les plus récents sont chargés. Affinez avec le
          filtre ci-dessus.
        </p>
      )}

      {/* ---------------------------------------------------------- liste */}
      {loading && !repos ? (
        <p className="flex items-center gap-3 rounded-2xl bg-panel p-8 text-sm text-mist ring-1 ring-edge">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement de vos dépôts…
        </p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-panel p-10 text-center ring-1 ring-edge">
          <FolderArchive className="mx-auto h-8 w-8 text-mist" />
          <p className="mt-3 text-sm text-mist">
            {repos?.length
              ? "Aucun dépôt ne correspond à ce filtre."
              : "Aucun dépôt visible avec ce jeton GitHub."}
          </p>
          <Link href="/import" className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
            Importer une archive
          </Link>
        </div>
      ) : (
        <>
          <p className="text-xs text-mist">
            {filtered.length} dépôt(s)
            {query || onlyMine ? ` sur ${repos?.length ?? 0}` : ""} — cliquez pour
            en parcourir le contenu.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {filtered.map((r) => (
              <li key={r.full_name}>
                <button
                  type="button"
                  onClick={() => update({ repo: r.full_name, ref: "", path: "", file: "" }, true)}
                  className="group flex w-full flex-col gap-2 rounded-2xl bg-panel p-4 text-left ring-1 ring-edge transition-colors hover:bg-panel2 hover:ring-go/30"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate font-medium text-chalk">{r.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {r.private && <Lock className="h-3.5 w-3.5 text-mist" />}
                      {r.fork && <GitFork className="h-3.5 w-3.5 text-mist" />}
                      {r.archived && <Archive className="h-3.5 w-3.5 text-amber" />}
                    </span>
                  </span>

                  <span className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-mist">
                    {r.description || <em className="text-mist/60">Sans description</em>}
                  </span>

                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mist/80">
                    {r.language && (
                      <Badge variant="muted">{r.language}</Badge>
                    )}
                    <span>{formatBytes(r.size * 1024)}</span>
                    {r.pushed_at && (
                      <span>poussé {timeAgo(new Date(r.pushed_at).getTime())}</span>
                    )}
                    {r.open_issues_count > 0 && (
                      <span>{r.open_issues_count} issue(s)</span>
                    )}
                    {!r.can.push && (
                      <span className="text-amber">lecture seule</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
