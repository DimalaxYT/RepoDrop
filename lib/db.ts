/**
 * Stockage des jobs : SQLite via le module bâti `node:sqlite`
 * (aucune dépendance native à compiler). Singleton résistant au HMR.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { frMessage } from "./errors";
import type { ArchiveFormat, ArchivePreview, JobRecord, JobStatus, PushOptions } from "./types";

export interface JobRow {
  id: string;
  login: string;
  filename: string;
  format: ArchiveFormat | null;
  status: JobStatus;
  error: string | null;
  preview: string | null;
  push_opts: string | null;
  push_result: string | null;
  archive_size: number;
  ip: string | null;
  created_at: number;
  updated_at: number;
}

function open(): DatabaseSync {
  fs.mkdirSync(path.dirname(configDbPath()), { recursive: true });
  const db = new DatabaseSync(configDbPath());
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      login       TEXT NOT NULL,
      filename    TEXT NOT NULL,
      format      TEXT,
      status      TEXT NOT NULL,
      error       TEXT,
      preview     TEXT,
      push_opts   TEXT,
      push_result TEXT,
      archive_size INTEGER NOT NULL DEFAULT 0,
      ip          TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_login_created ON jobs(login, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_login_pushed ON jobs(login, updated_at);

    /* Journal d'activité (panel staff) : qui a poussé quoi, quand. */
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,
      login      TEXT,
      detail     TEXT,
      ip         TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_login ON events(login, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, created_at DESC);

    /* Réglages applicatifs (le jeton Discord y est stocké CHIFFRÉ). */
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    /* Sondes de disponibilité (ping Discord toutes les N minutes). */
    CREATE TABLE IF NOT EXISTS pings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ok         INTEGER NOT NULL,
      latency_ms INTEGER,
      status     INTEGER,
      error      TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pings_created ON pings(created_at DESC);
  `);
  return db;
}

function configDbPath(): string {
  // Import différé pour éviter un cycle config <-> db
  // (config ne dépend pas de db, pas de cycle réel, mais restons prudents).
  return process.env.DB_PATH ?? `${process.cwd()}/data/repodrop.db`;
}

function getDb(): DatabaseSync {
  const g = globalThis as unknown as { __repodropDb?: DatabaseSync };
  if (!g.__repodropDb) g.__repodropDb = open();
  return g.__repodropDb;
}

export interface NewJob {
  id: string;
  login: string;
  filename: string;
  format: ArchiveFormat;
  archiveSize: number;
  ip: string | null;
}

export function insertJob(j: NewJob): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO jobs (id, login, filename, format, status, archive_size, ip, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    )
    .run(j.id, j.login, j.filename, j.format, j.archiveSize, j.ip, now, now);
}

export function updateJob(
  id: string,
  patch: Partial<{
    status: JobStatus;
    error: string | null;
    preview: ArchivePreview;
    push_opts: PushOptions;
    push_result: NonNullable<JobRecord["push"]>;
  }>,
): void {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    vals.push(patch.error);
  }
  if (patch.preview !== undefined) {
    sets.push("preview = ?");
    vals.push(JSON.stringify(patch.preview));
  }
  if (patch.push_opts !== undefined) {
    sets.push("push_opts = ?");
    vals.push(JSON.stringify(patch.push_opts));
  }
  if (patch.push_result !== undefined) {
    sets.push("push_result = ?");
    vals.push(JSON.stringify(patch.push_result));
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);
  getDb()
    .prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
}

function rowToRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    login: row.login,
    filename: row.filename,
    format: row.format,
    status: row.status,
    error: row.error,
    preview: row.preview ? (JSON.parse(row.preview) as ArchivePreview) : null,
    push: row.push_result ? (JSON.parse(row.push_result) as JobRecord["push"]) : null,
    archiveSize: row.archive_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getJob(id: string): JobRecord | null {
  const row = getDb()
    .prepare(`SELECT * FROM jobs WHERE id = ?`)
    .get(id) as JobRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getJobRow(id: string): JobRow | null {
  const row = getDb().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
    | JobRow
    | undefined;
  return row ?? null;
}

/** Nombre de poussées réussies récentes (rate-limit persistant). */
export function countRecentPushes(login: string, sinceMs: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE login = ? AND status = 'done' AND updated_at >= ?`,
    )
    .get(login, sinceMs) as { n: number };
  return Number(row.n);
}

/** Marque tous les jobs non terminaux comme échoués (appelé au démarrage). */
export function failStaleJobs(): number {
  const res = getDb()
    .prepare(
      `UPDATE jobs SET status = 'failed', error = ?, updated_at = ?
       WHERE status IN ('queued', 'extracting', 'pushing')`,
    )
    .run(frMessage("INTERRUPTED"), Date.now());
  return Number(res.changes ?? 0);
}

/** Purge des dossiers de jobs plus vieux que `maxAgeMs` + jobs terminaux. */
export function cleanupOldJobsDir(jobsDir: string, maxAgeMs: number): void {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(jobsDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const id of entries) {
    const dir = path.join(jobsDir, id);
    try {
      const st = fs.statSync(dir);
      if (st.isDirectory() && st.mtimeMs < cutoff) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------- journal d'activité */

/**
 * Types d'événements tracés. `push` est celui qui répond à « qui a poussé du
 * code, et quand » : le détail porte le dépôt, la branche, le SHA, le volume.
 */
export type EventKind =
  | "upload"
  | "push"
  | "login"
  | "logout"
  | "settings"
  | "discord"
  | "system";

export interface ActivityEvent {
  id: number;
  kind: EventKind;
  login: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: number;
}

interface EventRow {
  id: number;
  kind: string;
  login: string | null;
  detail: string | null;
  ip: string | null;
  created_at: number;
}

/** Écrit un événement. N'échoue JAMAIS : la traçabilité ne bloque pas le flux. */
export function logEvent(e: {
  kind: EventKind;
  login?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown> | null;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO events (kind, login, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        e.kind,
        e.login ?? null,
        e.detail ? JSON.stringify(e.detail) : null,
        e.ip ?? null,
        Date.now(),
      );
  } catch (err) {
    console.error("[db] logEvent:", err);
  }
}

function rowToEvent(row: EventRow): ActivityEvent {
  let detail: Record<string, unknown> | null = null;
  if (row.detail) {
    try {
      detail = JSON.parse(row.detail) as Record<string, unknown>;
    } catch {
      detail = null;
    }
  }
  return {
    id: row.id,
    kind: row.kind as EventKind,
    login: row.login,
    detail,
    ip: row.ip,
    createdAt: row.created_at,
  };
}

export interface EventQuery {
  limit?: number;
  offset?: number;
  kind?: EventKind;
  login?: string;
  /** Sous-chaîne recherchée dans login + détail JSON. */
  q?: string;
}

function eventWhere(opts: EventQuery): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts.kind) {
    clauses.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.login) {
    clauses.push("login = ?");
    params.push(opts.login);
  }
  if (opts.q) {
    clauses.push("(login LIKE ? OR detail LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function listEvents(opts: EventQuery = {}): ActivityEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const w = eventWhere(opts);
  const rows = getDb()
    .prepare(
      `SELECT * FROM events ${w.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...w.params, limit, offset) as unknown as EventRow[];
  return rows.map(rowToEvent);
}

export function countEvents(opts: EventQuery = {}): number {
  const w = eventWhere(opts);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM events ${w.sql}`)
    .get(...w.params) as { n: number };
  return Number(row.n);
}

/**
 * Utilisateurs distincts ayant au moins un événement (pour les filtres).
 *
 * Les lignes de `node:sqlite` ont un prototype `null`, que la sérialisation
 * RSC refuse (« Only plain objects… ») : on recopie donc dans des objets
 * littéraux avant de les renvoyer.
 */
export function listEventLogins(
  limit = 50,
): { login: string; events: number; lastAt: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT login, COUNT(*) AS events, MAX(created_at) AS lastAt
       FROM events WHERE login IS NOT NULL AND login <> ''
       GROUP BY login ORDER BY lastAt DESC LIMIT ?`,
    )
    .all(limit) as unknown as {
    login: string;
    events: number | bigint;
    lastAt: number | bigint;
  }[];
  return rows.map((r) => ({
    login: String(r.login),
    events: Number(r.events),
    lastAt: Number(r.lastAt),
  }));
}

/** Statistiques d'activité pour l'en-tête du panel staff. */
export interface ActivityStats {
  totalJobs: number;
  totalPushes: number;
  failedPushes: number;
  pushes24h: number;
  users24h: number;
  lastPushAt: number | null;
}

export function activityStats(): ActivityStats {
  const db = getDb();
  const one = <T>(sql: string, ...params: (string | number)[]): T =>
    db.prepare(sql).get(...params) as T;
  const day = Date.now() - 24 * 3_600_000;
  return {
    totalJobs: one<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs`).n,
    totalPushes: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM events WHERE kind = 'push'`,
    ).n,
    failedPushes: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM events WHERE kind = 'push' AND json_extract(detail, '$.ok') = 0`,
    ).n,
    pushes24h: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM events WHERE kind = 'push' AND created_at >= ?`,
      day,
    ).n,
    users24h: one<{ n: number }>(
      `SELECT COUNT(DISTINCT login) AS n FROM events WHERE created_at >= ? AND login IS NOT NULL`,
      day,
    ).n,
    lastPushAt:
      one<{ at: number | null }>(
        `SELECT MAX(created_at) AS at FROM events WHERE kind = 'push'`,
      ).at ?? null,
  };
}

/** Purge les événements plus vieux que `maxAgeMs` (rétention configurable). */
export function pruneEvents(maxAgeMs: number): number {
  const res = getDb()
    .prepare(`DELETE FROM events WHERE created_at < ?`)
    .run(Date.now() - maxAgeMs);
  return Number(res.changes ?? 0);
}

/* ------------------------------------------------------------------ réglages */

/**
 * Lecture/écriture brute des réglages. Les valeurs SENSIBLES doivent être
 * chiffrées par l'appelant (cf. lib/settings.ts) — la base ne voit jamais un
 * jeton en clair.
 */
export function getSettingRaw(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSettingRaw(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now());
}

export function deleteSettingRaw(key: string): void {
  getDb().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

export function listSettingsRaw(): Record<string, { value: string; updatedAt: number }> {
  const rows = getDb()
    .prepare(`SELECT key, value, updated_at FROM settings`)
    .all() as { key: string; value: string; updated_at: number }[];
  return Object.fromEntries(
    rows.map((r) => [r.key, { value: r.value, updatedAt: r.updated_at }]),
  );
}

/* ------------------------------------------------- sondes de disponibilité */

export interface PingRecord {
  ok: boolean;
  latencyMs: number | null;
  status: number | null;
  error?: string | null;
}

export function recordPing(p: PingRecord): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO pings (ok, latency_ms, status, error, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        p.ok ? 1 : 0,
        p.latencyMs,
        p.status,
        p.error ?? null,
        Date.now(),
      );
  } catch (err) {
    console.error("[db] recordPing:", err);
  }
}

export interface PingRow {
  id: number;
  ok: boolean;
  latencyMs: number | null;
  status: number | null;
  error: string | null;
  createdAt: number;
}

export function listPings(limit = 60): PingRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, ok, latency_ms, status, error, created_at FROM pings
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 500)) as unknown as {
    id: number;
    ok: number;
    latency_ms: number | null;
    status: number | null;
    error: string | null;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    ok: r.ok === 1,
    latencyMs: r.latency_ms,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
  }));
}

export function pingStats(windowMs = 24 * 3_600_000): {
  total: number;
  ok: number;
  uptimePct: number | null;
  avgLatencyMs: number | null;
} {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok,
              AVG(CASE WHEN ok = 1 THEN latency_ms END) AS avgLatency
       FROM pings WHERE created_at >= ?`,
    )
    .get(Date.now() - windowMs) as {
    total: number;
    ok: number | null;
    avgLatency: number | null;
  };
  const total = Number(row.total ?? 0);
  const ok = Number(row.ok ?? 0);
  return {
    total,
    ok,
    uptimePct: total === 0 ? null : Math.round((ok / total) * 1000) / 10,
    avgLatencyMs: row.avgLatency === null ? null : Math.round(Number(row.avgLatency)),
  };
}

export function prunePings(maxAgeMs = 7 * 24 * 3_600_000): void {
  try {
    getDb().prepare(`DELETE FROM pings WHERE created_at < ?`).run(Date.now() - maxAgeMs);
  } catch (err) {
    console.error("[db] prunePings:", err);
  }
}
