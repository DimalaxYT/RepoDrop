"use client";

/**
 * Journal d'activité du panel staff : qui a poussé du code, où, et à quelle
 * heure. Rafraîchissement manuel ou automatique (15 s), filtres, pagination
 * et export CSV de la page courante.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Download,
  GitBranch,
  LogIn,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatBytes, formatDateTime, timeAgo } from "@/lib/utils";
import type { ActivityEvent, ActivityResponse, PushDetail } from "@/lib/staff-types";

const PAGE = 25;
const AUTO_REFRESH_MS = 15_000;

const KIND_META: Record<
  ActivityEvent["kind"] | "all",
  { label: string; icon: typeof Activity; tone: string }
> = {
  all: { label: "Tout", icon: Activity, tone: "text-chalk" },
  push: { label: "Push", icon: GitBranch, tone: "text-go" },
  upload: { label: "Upload", icon: Upload, tone: "text-sky" },
  login: { label: "Connexion", icon: LogIn, tone: "text-mist" },
  logout: { label: "Déconnexion", icon: LogIn, tone: "text-mist" },
  settings: { label: "Réglages", icon: Settings2, tone: "text-amber" },
  discord: { label: "Discord", icon: Bot, tone: "text-violet" },
  system: { label: "Système", icon: ShieldAlert, tone: "text-mist" },
};

export function ActivityFeed({ initial }: { initial: ActivityResponse }) {
  const [data, setData] = useState<ActivityResponse>(initial);
  const [kind, setKind] = useState<ActivityEvent["kind"] | "all">("all");
  const [login, setLogin] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextOffset: number, silent = false) => {
      if (!silent) setLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE),
        offset: String(nextOffset),
      });
      if (kind !== "all") params.set("kind", kind);
      if (login) params.set("login", login);
      if (search) params.set("q", search);
      try {
        const res = await fetch(`/api/staff/activity?${params}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as ActivityResponse & { error?: string };
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setData(body);
        setOffset(nextOffset);
      } catch {
        if (!silent) setError("Réseau indisponible.");
      } finally {
        setLoading(false);
      }
    },
    [kind, login, search],
  );

  // Rechargement quand un filtre change (et retour à la première page).
  useEffect(() => {
    void load(0);
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const iv = setInterval(() => void load(offset, true), AUTO_REFRESH_MS);
    return () => clearInterval(iv);
  }, [auto, load, offset]);

  const stats = data.stats;
  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(data.total / PAGE));

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------------------------------- statistiques */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Push réussis"
          value={String(stats.totalPushes - stats.failedPushes)}
          sub={`${stats.pushes24h} sur 24 h`}
          icon={GitBranch}
          tone="go"
        />
        <StatTile
          label="Utilisateurs actifs"
          value={String(stats.users24h)}
          sub="sur 24 h"
          icon={LogIn}
          tone="violet"
        />
        <StatTile
          label="Archives reçues"
          value={String(stats.totalJobs)}
          sub="depuis l'installation"
          icon={Upload}
          tone="sky"
        />
        <StatTile
          label="Push en échec"
          value={String(stats.failedPushes)}
          sub={
            stats.lastPushAt
              ? `dernier push ${timeAgo(stats.lastPushAt)}`
              : "aucun push"
          }
          icon={XCircle}
          tone={stats.failedPushes > 0 ? "danger" : "muted"}
        />
      </div>

      {/* ------------------------------------------------------------- barre */}
      <div className="panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(KIND_META) as (ActivityEvent["kind"] | "all")[]).map(
            (k) => {
              const meta = KIND_META[k];
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/40"
                      : "bg-panel2 text-mist ring-1 ring-edge hover:text-chalk",
                  )}
                >
                  <meta.icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              );
            },
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearch(q.trim());
                  void load(0);
                }
              }}
              placeholder="Rechercher un login, un dépôt, un fichier…"
              className="pl-9"
            />
          </div>
          <select
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="h-10 rounded-lg bg-panel2 px-3 text-sm text-chalk ring-1 ring-edge outline-none focus-visible:ring-2 focus-visible:ring-go/50"
          >
            <option value="">Tous les utilisateurs</option>
            {data.logins.map((l) => (
              <option key={l.login} value={l.login}>
                {l.login} ({l.events})
              </option>
            ))}
          </select>
          {search && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setSearch("");
              }}
            >
              Effacer
            </Button>
          )}
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-mist">
              <Switch
                checked={auto}
                onChange={setAuto}
                label="Rafraîchissement automatique"
              />
              Auto
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(offset)}
              disabled={loading}
            >
              {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
              Actualiser
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportCsv(data.events)}
              title="Exporter la page courante en CSV"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </span>
        </div>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      {/* -------------------------------------------------------------- liste */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="text-sm font-semibold">
            {data.total.toLocaleString("fr-FR")} événement
            {data.total > 1 ? "s" : ""}
          </h2>
          <div className="flex items-center gap-2 text-xs text-mist">
            <Button
              variant="ghost"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => void load(Math.max(0, offset - PAGE))}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={offset + PAGE >= data.total || loading}
              onClick={() => void load(offset + PAGE)}
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {data.events.length === 0 ? (
          <p className="px-4 py-14 text-center text-sm text-mist">
            Aucun événement pour ces filtres. Les push apparaîtront ici dès le
            premier import.
          </p>
        ) : (
          <ul className="divide-y divide-edge/70">
            {data.events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ détail */

function EventRow({ event }: { event: ActivityEvent }) {
  const meta = KIND_META[event.kind] ?? KIND_META.system;
  const push = event.kind === "push" ? (event.detail as unknown as PushDetail) : null;

  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-3 px-4 py-3 transition-colors hover:bg-panel2/60",
        push?.ok === true && "border-l-2 border-l-go/60",
        push?.ok === false && "border-l-2 border-l-danger/60",
      )}
    >
      {/* horodatage */}
      <div className="w-28 shrink-0 pt-0.5" title={formatDateTime(event.createdAt)}>
        <div className="text-xs font-medium text-chalk tabular-nums">
          {new Date(event.createdAt).toLocaleTimeString("fr-FR")}
        </div>
        <div className="text-[11px] text-mist">{timeAgo(event.createdAt)}</div>
      </div>

      {/* utilisateur */}
      <div className="flex min-w-36 shrink-0 items-center gap-2">
        {event.login ? (
          <>
            <img
              src={`https://github.com/${encodeURIComponent(event.login)}.png?size=48`}
              alt=""
              referrerPolicy="no-referrer"
              className="h-7 w-7 rounded-full bg-panel2 ring-1 ring-edge"
            />
            <span className="truncate text-sm font-medium text-chalk">
              {event.login}
            </span>
          </>
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-panel2 text-mist ring-1 ring-edge">
            <meta.icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {/* contenu */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={event.kind === "push" ? "default" : "muted"}>
            <meta.icon className="h-3 w-3" />
            {meta.label}
          </Badge>
          {push && (
            <Badge variant={push.ok ? "default" : "danger"}>
              {push.ok ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {push.ok ? "réussi" : "échec"}
            </Badge>
          )}
          <span className="truncate text-sm text-chalk/90">
            {describe(event, push)}
          </span>
        </div>

        {push && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {push.repo && (
              <Chip href={`https://github.com/${push.repo}`}>
                <GitBranch className="h-3 w-3" />
                {push.repo}
              </Chip>
            )}
            {push.branch && (
              <Chip
                href={
                  push.repo ? `https://github.com/${push.repo}/tree/${push.branch}` : undefined
                }
              >
                {push.branch}
              </Chip>
            )}
            {push.sha && (
              <Chip
                href={
                  push.repo ? `https://github.com/${push.repo}/commit/${push.sha}` : undefined
                }
                mono
              >
                {push.sha.slice(0, 7)}
              </Chip>
            )}
            {push.files !== undefined && <Chip>{push.files} fichiers</Chip>}
            {push.bytes ? <Chip>{formatBytes(push.bytes)}</Chip> : null}
            {push.filename && <Chip>{push.filename}</Chip>}
            {push.created && <Chip>dépôt créé</Chip>}
          </div>
        )}
        {push?.error && (
          <p className="mt-1.5 text-[11px] text-danger/90">{push.error}</p>
        )}
      </div>

      {/* ip */}
      {event.ip && (
        <span className="shrink-0 font-mono text-[11px] text-mist/70">
          {event.ip}
        </span>
      )}
    </li>
  );
}

function describe(e: ActivityEvent, push: PushDetail | null): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case "push":
      return push?.ok
        ? `a poussé du code${push.repo ? ` vers ${push.repo}` : ""}`
        : "push en échec";
    case "upload":
      return `a déposé ${String(d.filename ?? "une archive")}`;
    case "login":
      return "s'est connecté";
    case "logout":
      return "s'est déconnecté";
    case "settings":
      return `a modifié les réglages (${
        Array.isArray(d.changed) ? d.changed.join(", ") : "discord"
      })`;
    case "discord":
      return `Discord : ${String(d.action ?? "action")}${
        d.ok === false ? " (échec)" : ""
      }`;
    default:
      return String(d.message ?? "événement système");
  }
}

function Chip({
  children,
  href,
  mono,
}: {
  children: React.ReactNode;
  href?: string;
  mono?: boolean;
}) {
  const cls = cn(
    "inline-flex items-center gap-1 rounded-md bg-panel2 px-1.5 py-0.5 ring-1 ring-edge",
    mono && "font-mono",
    href ? "text-sky/90 hover:text-sky hover:ring-sky/40" : "text-mist",
  );
  if (!href) return <span className={cls}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  );
}

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Activity;
  tone: "go" | "sky" | "violet" | "danger" | "muted";
}) {
  const tones = {
    go: "bg-go/10 text-go ring-go/25",
    sky: "bg-sky/10 text-sky ring-sky/25",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-400/25",
    danger: "bg-danger/10 text-danger ring-danger/25",
    muted: "bg-panel2 text-mist ring-edge",
  } as const;
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className={cn("grid h-10 w-10 place-items-center rounded-xl ring-1", tones[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-mist">{label}</div>
        <div className="text-xl font-semibold tabular-nums text-chalk">{value}</div>
        <div className="truncate text-[11px] text-mist">{sub}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- export CSV */

function exportCsv(events: ActivityEvent[]): void {
  const header = [
    "date",
    "type",
    "login",
    "statut",
    "depot",
    "branche",
    "commit",
    "fichiers",
    "octets",
    "archive",
    "ip",
  ];
  const rows = events.map((e) => {
    const d = (e.detail ?? {}) as Record<string, unknown> as PushDetail &
      Record<string, unknown>;
    return [
      new Date(e.createdAt).toISOString(),
      e.kind,
      e.login ?? "",
      e.kind === "push" ? (d.ok ? "ok" : "echec") : "",
      d.repo ?? "",
      d.branch ?? "",
      d.sha ?? "",
      d.files ?? "",
      d.bytes ?? "",
      d.filename ?? "",
      e.ip ?? "",
    ];
  });
  const csv = [header, ...rows]
    .map((r) =>
      r
        .map((c) => {
          const s = String(c);
          return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(";"),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `repodrop-activite-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
