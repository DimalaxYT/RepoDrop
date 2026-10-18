"use client";

/**
 * Vue d'un job : statuts en direct (polling), aperçu de l'archive,
 * choix de la destination, lancement du push, résultat.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  File,
  FileText,
  Folder,
  GitBranch,
  GitFork,
  Lock,
  Rocket,
  Search,
  Unlock,
} from "lucide-react";
import type { JobRecord, PreviewEntry } from "@/lib/types";
import type { PushableRepo } from "@/lib/github";
import { formatBytes, formatCount } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Spinner, IndeterminateBar } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const POLLING = new Set(["queued", "extracting", "pushing"]);

const STATUS_META: Record<
  JobRecord["status"],
  { label: string; variant: "default" | "sky" | "muted" | "danger" | "amber" }
> = {
  queued: { label: "En file d'attente", variant: "muted" },
  extracting: { label: "Extraction", variant: "sky" },
  ready: { label: "Prêt à pousser", variant: "default" },
  pushing: { label: "Poussage…", variant: "sky" },
  done: { label: "Terminé", variant: "default" },
  failed: { label: "Échec", variant: "danger" },
};

const REPO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function JobView({ initialJob }: { initialJob: JobRecord }) {
  const [job, setJob] = useState(initialJob);
  const id = job.id;

  // ------------------------------------------------------------- polling
  useEffect(() => {
    if (!POLLING.has(job.status)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { job?: JobRecord };
        if (cancelled || !data.job) return;
        const next = data.job;
        // Arborescence parfois très lourde : on ne déclenche un re-render
        // que si l'état a réellement changé (même objet ⇒ pas de rendu).
        setJob((prev) =>
          prev.status === next.status && prev.updatedAt === next.updatedAt
            ? prev
            : next,
        );
      } catch {
        /* on retentera au prochain tick */
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 1200);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [id, job.status]);

  const meta = STATUS_META[job.status];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* ------------------------------------------------------- en-tête */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel2 text-mist ring-1 ring-edge">
            <Archive className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight" title={job.filename}>
              {job.filename}
            </h1>
            <p className="text-xs text-mist">
              {new Date(job.createdAt).toLocaleString("fr-FR")} ·{" "}
              {formatBytes(job.archiveSize)} · {job.login}
            </p>
          </div>
        </div>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      {/* ------------------------------------------------------ états */}
      {(job.status === "queued" || job.status === "extracting") && <ExtractingState />}
      {job.status === "pushing" && <PushingState />}
      {job.status === "ready" && job.preview && (
        <ReadyState job={job} onPushing={(j) => setJob(j)} />
      )}
      {job.status === "done" && job.push && <DoneState job={job} />}
      {job.status === "failed" && <FailedState job={job} />}
    </div>
  );
}

/* ------------------------------------------------------------------ états */

function ExtractingState() {
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex flex-col items-center gap-5 py-14 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-sky/10 text-sky ring-1 ring-sky/25">
          <Spinner className="h-7 w-7" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Extraction en cours…</h2>
          <p className="mt-1.5 max-w-md text-sm text-mist">
            Vérification des chemins, limite de taille, détection du dossier racine. Tout se
            passe côté serveur, dans un espace isolé.
          </p>
        </div>
        <IndeterminateBar className="max-w-xs" />
      </CardContent>
    </Card>
  );
}

function PushingState() {
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex flex-col items-center gap-5 py-14 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-go/10 text-go ring-1 ring-go/25">
          <Spinner className="h-7 w-7" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Poussage vers GitHub…</h2>
          <p className="mt-1.5 max-w-md text-sm text-mist">
            Création du commit et envoi des fichiers. L'onglet peut rester ouvert, on vous tient
            au courant.
          </p>
        </div>
        <IndeterminateBar className="max-w-xs" />
      </CardContent>
    </Card>
  );
}

function FailedState({ job }: { job: JobRecord }) {
  return (
    <Card className="animate-fade-in border-danger/30">
      <CardContent className="flex flex-col items-center gap-5 py-14 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger ring-1 ring-danger/25">
          <AlertTriangle className="h-7 w-7" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">L'opération a échoué</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-mist">
            {job.error ?? "Erreur inconnue."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/import" className={buttonVariants({})}>
            Réessayer avec une autre archive
          </Link>
          <Link href="/" className={buttonVariants({ variant: "ghost" })}>
            Retour à l'accueil
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function DoneState({ job }: { job: JobRecord }) {
  const push = job.push!;
  const shortSha = push.commitSha?.slice(0, 7);
  return (
    <Card className="animate-fade-in border-go/40 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_50%_-20%,rgba(52,211,153,0.14),transparent)]" />
      <CardContent className="relative flex flex-col items-center gap-5 py-14 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-go/15 text-go ring-1 ring-go/40">
          <CheckCircle2 className="h-8 w-8" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">C'est poussé&nbsp;!</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-mist">
            {formatCount(job.preview?.fileCount ?? 0)} importés sur la branche{" "}
            <code className="rounded bg-panel2 px-1.5 py-0.5 text-xs text-chalk ring-1 ring-edge">
              {push.branch}
            </code>
            {shortSha && (
              <>
                {" "}
                · commit <code className="rounded bg-panel2 px-1.5 py-0.5 text-xs text-chalk ring-1 ring-edge">{shortSha}</code>
              </>
            )}
            {push.created && " · dépôt créé"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={push.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "lg" })}
          >
            <GitFork className="h-4 w-4" />
            Ouvrir sur GitHub
            <ArrowRight className="h-4 w-4" />
          </a>
          <Link href="/import" className={buttonVariants({ variant: "outline" })}>
            Importer une autre archive
          </Link>
        </div>
        <a
          href={push.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-mist underline decoration-edge underline-offset-4 hover:text-chalk"
        >
          {push.url.replace("https://", "")}
        </a>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- aperçu */

function TreeLine({ entry }: { entry: PreviewEntry }) {
  const isDir = entry.path.endsWith("/");
  const clean = isDir ? entry.path.slice(0, -1) : entry.path;
  const parts = clean.split("/");
  const depth = parts.length - 1;
  const name = parts[parts.length - 1];
  const Icon = isDir ? Folder : entry.path.match(/\.(md|txt|rst|json)$/i) ? FileText : File;
  return (
    <div
      className="flex items-center justify-between gap-3 rounded px-2 py-1 text-xs hover:bg-panel2"
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon
          className={cn("h-3.5 w-3.5 shrink-0", isDir ? "text-sky/80" : "text-mist/70")}
        />
        <span className={cn("truncate", isDir && "text-chalk/90 font-medium")}>
          {name}
          {isDir && "/"}
        </span>
      </span>
      {!isDir && entry.size > 0 && (
        <span className="shrink-0 tabular-nums text-mist/70">{formatBytes(entry.size)}</span>
      )}
    </div>
  );
}

function PreviewPanel({ job }: { job: JobRecord }) {
  const p = job.preview!;
  const ignoredParts: string[] = [];
  if (p.ignored.gitDirs > 0) ignoredParts.push(`.git (${p.ignored.gitDirs})`);
  if (p.ignored.systemFiles > 0)
    ignoredParts.push(`fichiers système (${p.ignored.systemFiles})`);
  if (p.ignored.symlinks > 0) ignoredParts.push(`symlinks (${p.ignored.symlinks})`);
  if (p.ignored.outside > 0) ignoredParts.push(`chemins bloqués (${p.ignored.outside})`);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Aperçu de l'archive</CardTitle>
          <Badge variant={job.format === "rar" ? "sky" : "muted"}>
            {job.format?.toUpperCase()}
          </Badge>
        </div>
        <CardDescription>Ce qui sera poussé, après filtres de sécurité.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Fichiers" value={formatCount(p.fileCount)} />
          <Stat label="Poids décompressé" value={formatBytes(p.totalSize)} />
        </div>

        {ignoredParts.length > 0 && (
          <p className="text-xs text-mist">
            <span className="text-chalk/80">Ignorés :</span> {ignoredParts.join(" · ")}
          </p>
        )}

        {p.tooLargeForGitHub.count > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber/10 p-3 text-xs leading-relaxed text-amber ring-1 ring-amber/30">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {p.tooLargeForGitHub.count} fichier(s) dépassent 100 Mo : GitHub les refusera
              probablement. Ex. :{" "}
              <code className="text-chalk">
                {p.tooLargeForGitHub.examples[0]?.path}{" "}
                ({formatBytes(p.tooLargeForGitHub.examples[0]?.size ?? 0)})
              </code>
            </span>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto rounded-xl bg-ink/60 p-2 ring-1 ring-edge">
          {p.tree.map((e) => (
            <TreeLine key={e.path} entry={e} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel2 px-3 py-2.5 ring-1 ring-edge">
      <div className="text-[11px] uppercase tracking-wide text-mist">{label}</div>
      <div className="mt-0.5 font-medium text-chalk">{value}</div>
    </div>
  );
}

/* ----------------------------------------------------------- destination */

function ReadyState({
  job,
  onPushing,
}: {
  job: JobRecord;
  onPushing: (job: JobRecord) => void;
}) {
  const p = job.preview!;

  // options
  const [stripRoot, setStripRoot] = useState(Boolean(p.singleRootDir));
  const [includeNM, setIncludeNM] = useState(false);

  // destination
  const [dest, setDest] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [search, setSearch] = useState("");

  // avancé
  const [dedicated, setDedicated] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [commitMsg, setCommitMsg] = useState("");

  // état réseau
  const [repos, setRepos] = useState<PushableRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Chargement des dépôts (une seule fois, à la demande).
  useEffect(() => {
    if (dest !== "existing" || repos !== null) return;
    let cancelled = false;
    fetch("/api/repos", { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as { repos?: PushableRepo[]; error?: string };
        if (cancelled) return;
        if (r.ok) setRepos(data.repos ?? []);
        else {
          setRepos([]);
          setReposError(data.error ?? "Impossible de charger vos dépôts.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepos([]);
          setReposError("Impossible de charger vos dépôts.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dest, repos]);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = search.trim().toLowerCase();
    const list = q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;
    return list.slice(0, 60);
  }, [repos, search]);

  const nameValid = REPO_NAME_RE.test(name.trim());
  const canPush =
    !busy &&
    ((dest === "new" && nameValid) || (dest === "existing" && Boolean(selectedRepo)));

  const submit = useCallback(async () => {
    setFormError(null);
    if (!canPush) return;
    setBusy(true);
    try {
      const body = {
        mode: dest,
        name: dest === "new" ? name.trim() : undefined,
        private: visibility === "private",
        repo: dest === "existing" ? selectedRepo : undefined,
        dedicatedBranch: dedicated,
        branchName: dedicated ? branchName.trim() || undefined : undefined,
        includeNodeModules: includeNM,
        stripRoot,
        commitMessage: commitMsg.trim() || undefined,
      };
      const res = await fetch(`/api/jobs/${job.id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 202) {
        onPushing({ ...job, status: "pushing" });
        return;
      }
      setFormError(data.error ?? `Échec (HTTP ${res.status}).`);
    } catch {
      setFormError("Connexion perdue. Réessayez.");
    } finally {
      setBusy(false);
    }
  }, [
    canPush,
    commitMsg,
    dedicated,
    dest,
    includeNM,
    job,
    name,
    onPushing,
    selectedRepo,
    stripRoot,
    visibility,
    branchName,
  ]);

  const defaultBranchHint = `import/${job.filename.replace(/\.[^.]+$/, "").toLowerCase()}`;

  return (
    <div className="grid gap-5 lg:grid-cols-2 animate-fade-in">
      {/* ---------------------------------------------------- aperçu */}
      <div className="flex flex-col gap-5">
        <PreviewPanel job={job} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Filtres d'import</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-1">
            {p.singleRootDir && (
              <CheckRow
                row
                checked={stripRoot}
                onChange={setStripRoot}
                label={
                  <>
                    Retirer le dossier racine{" "}
                    <code className="text-chalk">{p.singleRootDir}/</code>
                    <span className="block text-xs font-normal text-mist">
                      Recommandé : le contenu du projet irait à la racine du dépôt.
                    </span>
                  </>
                }
              />
            )}
            {p.hasNodeModules && (
              <CheckRow
                row
                checked={includeNM}
                onChange={setIncludeNM}
                label={
                  <>
                    Inclure <code className="text-chalk">node_modules</code>
                    <span className="block text-xs font-normal text-mist">
                      Décoché par défaut : lourd et rarement utile dans un dépôt.
                    </span>
                  </>
                }
              />
            )}
            {!p.singleRootDir && !p.hasNodeModules && (
              <p className="text-xs text-mist">Aucun filtre disponible pour cette archive.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* -------------------------------------------------- destination */}
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Destination</CardTitle>
            <CardDescription>Où pousser ces fichiers&nbsp;?</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-1">
            {/* onglets radio */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-panel2 p-1 ring-1 ring-edge">
              <DestTab active={dest === "new"} onClick={() => setDest("new")}>
                <Rocket className="h-4 w-4" /> Nouveau dépôt
              </DestTab>
              <DestTab active={dest === "existing"} onClick={() => setDest("existing")}>
                <GitBranch className="h-4 w-4" /> Dépôt existant
              </DestTab>
            </div>

            {dest === "new" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="repo-name">Nom du dépôt</Label>
                  <Input
                    id="repo-name"
                    placeholder="mon-projet"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {name.length > 0 && !nameValid && (
                    <p className="text-xs text-danger">
                      Lettres, chiffres, points, tirets et tirets bas uniquement (doit commencer
                      par une lettre ou un chiffre).
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Visibilité</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <VisBtn
                      active={visibility === "private"}
                      onClick={() => setVisibility("private")}
                      icon={<Lock className="h-3.5 w-3.5" />}
                      title="Privé"
                      hint="Visible par vous seul"
                    />
                    <VisBtn
                      active={visibility === "public"}
                      onClick={() => setVisibility("public")}
                      icon={<Unlock className="h-3.5 w-3.5" />}
                      title="Public"
                      hint="Visible par tout le monde"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" />
                  <Input
                    placeholder="Rechercher un dépôt…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>

                {repos === null && (
                  <div className="flex items-center justify-center gap-2 rounded-xl bg-panel2 py-8 text-sm text-mist ring-1 ring-edge">
                    <Spinner /> Chargement de vos dépôts…
                  </div>
                )}
                {repos !== null && reposError && (
                  <div className="flex items-start gap-2 rounded-xl bg-danger/10 p-3 text-xs text-danger ring-1 ring-danger/25">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {reposError}
                  </div>
                )}
                {repos !== null && !reposError && filtered.length === 0 && (
                  <div className="rounded-xl bg-panel2 py-8 text-center text-sm text-mist ring-1 ring-edge">
                    {repos.length === 0
                      ? "Aucun dépôt accessible avec droits d'écriture. Créez-en un nouveau !"
                      : "Aucun dépôt ne correspond à la recherche."}
                  </div>
                )}
                {repos !== null && filtered.length > 0 && (
                  <div className="max-h-64 overflow-y-auto rounded-xl ring-1 ring-edge">
                    {filtered.map((r) => {
                      const active = selectedRepo === r.full_name;
                      return (
                        <button
                          key={r.full_name}
                          type="button"
                          onClick={() => setSelectedRepo(r.full_name)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 border-b border-edge/60 px-3 py-2.5 text-left text-sm transition-colors last:border-0 cursor-pointer",
                            active ? "bg-go/10 text-chalk" : "hover:bg-panel2 text-mist",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <GitFork
                              className={cn("h-3.5 w-3.5 shrink-0", active && "text-go")}
                            />
                            <span className="truncate">{r.full_name}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs">
                            {r.private && <Lock className="h-3 w-3" />}
                            {active && <Check className="h-4 w-4 text-go" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* options de branche */}
            <div className="border-t border-edge/60 pt-4">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={dedicated}
                  onChange={(e) => setDedicated(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#34d399]"
                />
                <span>
                  Créer une branche dédiée
                  <span className="block text-xs font-normal text-mist">
                    {dest === "existing"
                      ? "Ne pas toucher à la branche par défaut : idéal pour un dépôt partagé."
                      : "Nom de branche initial du nouveau dépôt (sinon la branche par défaut)."}
                  </span>
                </span>
              </label>
              {dedicated && (
                <Input
                  placeholder={defaultBranchHint}
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="mt-2.5"
                  maxLength={100}
                  autoComplete="off"
                />
              )}
            </div>

            {/* avancé */}
            <details className="group border-t border-edge/60 pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-mist transition-colors hover:text-chalk">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                Options avancées
              </summary>
              <div className="mt-3 flex flex-col gap-1.5">
                <Label htmlFor="commit-msg">Message de commit</Label>
                <Input
                  id="commit-msg"
                  placeholder={`Import de ${job.filename} via RepoDrop`}
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  maxLength={200}
                />
              </div>
            </details>
          </CardContent>
        </Card>

        {/* action */}
        <div className="flex flex-col gap-3">
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-danger/10 p-3.5 text-sm text-danger ring-1 ring-danger/25 animate-fade-in"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <Button size="lg" className="w-full" disabled={!canPush} onClick={() => void submit()}>
            {busy ? <Spinner /> : <Rocket className="h-4 w-4" />}
            {busy ? "Envoi…" : "Pousser sur GitHub"}
          </Button>
          <p className="text-center text-xs text-mist">
            Votre jeton GitHub reste dans un cookie chiffré — il n'est jamais écrit en base.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- petits éléments */

function DestTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer",
        active ? "bg-panel text-chalk shadow-sm ring-1 ring-edge" : "text-mist hover:text-chalk",
      )}
    >
      {children}
    </button>
  );
}

function VisBtn({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-xl p-3 text-left ring-1 transition-colors cursor-pointer",
        active
          ? "bg-go/10 ring-go/40"
          : "bg-panel2 ring-edge hover:ring-mist/40",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-sm font-medium", active ? "text-go" : "text-chalk")}>
        {icon}
        {title}
      </span>
      <span className="text-xs text-mist">{hint}</span>
    </button>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  row = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  row?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-sm", row && "w-full")}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#34d399]"
      />
      <span>{label}</span>
    </label>
  );
}
