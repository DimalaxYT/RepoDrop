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
