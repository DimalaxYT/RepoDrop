/**
 * Types partagés entre la page `/staff` (serveur) et ses composants clients.
 * Uniquement des `import type` : ce module n'entraîne aucun code serveur
 * (node:sqlite, child_process…) dans le bundle navigateur.
 */
import type { ActivityEvent, ActivityStats, PingRow } from "./db";
import type { DiscordSettingsView } from "./settings";
import type { MonitorStatus } from "./discord/monitor";

export interface ActivityLogin {
  login: string;
  events: number;
  lastAt: number;
}

export interface UptimeStats {
  total: number;
  ok: number;
  uptimePct: number | null;
  avgLatencyMs: number | null;
}

/** Réponse de GET /api/staff/activity. */
export interface ActivityResponse {
  events: ActivityEvent[];
  total: number;
  stats: ActivityStats;
  logins: ActivityLogin[];
  pings: PingRow[];
  uptime: UptimeStats;
  page: { limit: number; offset: number };
}

/** Réponse de GET /api/staff/settings. */
export interface StaffSettingsResponse {
  settings: DiscordSettingsView;
  status: MonitorStatus;
  staffConfigured: boolean;
  persistentSecrets: boolean;
}

/** Détail d'un événement `push` (tel qu'écrit par lib/jobs.ts). */
export interface PushDetail {
  ok: boolean;
  jobId?: string;
  repo?: string;
  branch?: string;
  sha?: string;
  files?: number;
  bytes?: number;
  filename?: string;
  created?: boolean;
  mode?: string;
  error?: string;
}

export type { ActivityEvent, ActivityStats, PingRow, DiscordSettingsView, MonitorStatus };
