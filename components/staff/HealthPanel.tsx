"use client";

/**
 * Onglet « Système » : historique de disponibilité (les sondes du bot),
 * et l'état de la configuration — utile pour diagnostiquer sans SSH.
 */
import { AlertTriangle, CheckCircle2, Gauge, ServerCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatBytes, formatDateTime, timeAgo } from "@/lib/utils";
import type { PingRow, UptimeStats } from "@/lib/staff-types";

export interface ConfigView {
  appUrl: string;
  jobsDir: string;
  maxUploadBytes: number;
  maxExtractBytes: number;
  maxFiles: number;
  pushesPerHour: number;
  uploadsPerHour: number;
  devAuth: boolean;
  sessionSecretSet: boolean;
  staffLogins: string[];
  nodeVersion: string;
}

export function HealthPanel({
  pings,
  uptime,
  configView,
}: {
  pings: PingRow[];
  uptime: UptimeStats;
  configView: ConfigView;
}) {
  // Du plus ancien au plus récent pour la lecture gauche → droite.
  const ordered = [...pings].reverse();

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-violet-300" />
            Disponibilité du site
          </CardTitle>
          <CardDescription>
            Chaque barre est une sonde du bot Discord ({pings.length} dernières,
            7 jours conservés).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label="Disponibilité 24 h"
              value={uptime.uptimePct !== null ? `${uptime.uptimePct} %` : "—"}
            />
            <Metric
              label="Latence moyenne"
              value={uptime.avgLatencyMs !== null ? `${uptime.avgLatencyMs} ms` : "—"}
            />
            <Metric label="Sondes" value={`${uptime.ok}/${uptime.total}`} />
          </div>

          {ordered.length === 0 ? (
            <p className="rounded-xl bg-panel2 p-6 text-center text-sm text-mist ring-1 ring-edge">
              Aucune sonde pour l'instant. Activez le bot Discord (onglet
              précédent) ou cliquez sur « Ping maintenant ».
            </p>
          ) : (
            <div className="flex h-24 items-end gap-[2px] rounded-xl bg-panel2 p-2 ring-1 ring-edge">
              {ordered.map((p) => {
                const maxLatency = Math.max(
                  1,
                  ...ordered.map((x) => x.latencyMs ?? 0),
                );
                const h = p.ok
                  ? Math.max(8, Math.round(((p.latencyMs ?? 0) / maxLatency) * 100))
                  : 100;
                return (
                  <span
                    key={p.id}
                    title={`${p.ok ? "OK" : "HS"} · ${formatDateTime(p.createdAt)}${
                      p.latencyMs !== null ? ` · ${p.latencyMs} ms` : ""
                    }${p.error ? ` · ${p.error}` : ""}`}
                    style={{ height: `${h}%` }}
                    className={cn(
                      "flex-1 rounded-sm transition-colors",
                      p.ok ? "bg-go/70 hover:bg-go" : "bg-danger/80 hover:bg-danger",
                    )}
                  />
                );
              })}
            </div>
          )}

          <div className="overflow-hidden rounded-xl ring-1 ring-edge">
            <table className="w-full text-xs">
              <thead className="bg-panel2 text-mist">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Quand</th>
                  <th className="px-3 py-2 text-left font-medium">État</th>
                  <th className="px-3 py-2 text-right font-medium">Latence</th>
                  <th className="px-3 py-2 text-right font-medium">HTTP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/70">
                {pings.slice(0, 12).map((p) => (
                  <tr key={p.id} className="hover:bg-panel2/60">
                    <td className="px-3 py-2 text-chalk/90" title={formatDateTime(p.createdAt)}>
                      {timeAgo(p.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {p.ok ? (
                        <span className="inline-flex items-center gap-1 text-go">
                          <CheckCircle2 className="h-3.5 w-3.5" /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {p.error ?? "HS"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-mist">
                      {p.latencyMs !== null ? `${p.latencyMs} ms` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-mist">
                      {p.status ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="h-4 w-4 text-violet-300" />
            Configuration
          </CardTitle>
          <CardDescription>
            Valeurs effectives au démarrage du process.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ConfigRow label="URL publique" value={configView.appUrl} mono />
          <ConfigRow label="Node.js" value={configView.nodeVersion} mono />
          <ConfigRow
            label="Upload max"
            value={`${formatBytes(configView.maxUploadBytes)} · ${formatBytes(
              configView.maxExtractBytes,
            )} décompressés`}
          />
          <ConfigRow
            label="Fichiers max"
            value={configView.maxFiles.toLocaleString("fr-FR")}
          />
          <ConfigRow
            label="Rate-limit"
            value={`${configView.pushesPerHour} push/h · ${configView.uploadsPerHour} uploads/h`}
          />
          <ConfigRow label="Dossier de travail" value={configView.jobsDir} mono />
          <ConfigRow
            label="SESSION_SECRET"
            value={configView.sessionSecretSet ? "défini" : "ABSENT"}
            badge={configView.sessionSecretSet ? "ok" : "danger"}
          />
          <ConfigRow
            label="Comptes staff"
            value={
              configView.staffLogins.length
                ? configView.staffLogins.join(", ")
                : configView.devAuth
                  ? "tous les comptes (mode dev)"
                  : "aucun"
            }
            badge={
              configView.staffLogins.length === 0 && !configView.devAuth
                ? "danger"
                : "ok"
            }
          />
          {configView.devAuth && (
            <p className="rounded-lg bg-amber/10 p-3 text-xs leading-relaxed text-amber ring-1 ring-amber/30">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              <code>DEV_AUTH=1</code> est actif : la connexion directe par jeton
              serveur est proposée et le panel staff est ouvert à tout compte
              connecté. À désactiver en production.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-panel2 px-3 py-2.5 ring-1 ring-edge">
      <div className="text-[10px] uppercase tracking-wide text-mist">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-chalk">{value}</div>
    </div>
  );
}

function ConfigRow({
  label,
  value,
  mono,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: "ok" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-panel2 px-3 py-2 ring-1 ring-edge">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-mist">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "truncate text-xs text-chalk/90",
            mono && "font-mono text-[11px]",
          )}
          title={value}
        >
          {value}
        </span>
        {badge && (
          <Badge variant={badge === "ok" ? "default" : "danger"}>
            {badge === "ok" ? "ok" : "à corriger"}
          </Badge>
        )}
      </span>
    </div>
  );
}
