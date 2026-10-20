/**
 * Moniteur Discord : le « bot qui ping le site toutes les 10 minutes ».
 *
 * Un timer unique (singleton globalThis, comme le worker de jobs) :
 *  1. sonde l'application (`GET <APP_URL>/api/health`) et mesure la latence ;
 *  2. enregistre la sonde en base (historique de disponibilité du panel) ;
 *  3. publie l'état sur Discord — à chaque ping si le heartbeat est actif,
 *     ou seulement quand ça casse / quand ça revient ;
 *  4. annonce chaque push (`announcePush`, appelé par lib/jobs.ts).
 *
 * Le jeton Discord n'est lu que depuis la base chiffrée (lib/settings.ts) et
 * n'apparaît jamais dans les logs.
 */
import { performance } from "node:perf_hooks";
import { activityStats, logEvent, pingStats, prunePings, recordPing } from "../db";
import { config } from "../config";
import {
  getDiscordSettings,
  isWebhookUrl,
  type DiscordSettings,
} from "../settings";
import {
  DiscordBot,
  sendMessage,
  type ClientDeps,
  type SentMessage,
} from "./client";
import {
  buildHeartbeatPayload,
  buildPushPayload,
  type PushEventInfo,
  type SiteProbe,
} from "./messages";

export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/** Résultat d'une sonde HTTP du site. */
export async function probeSite(
  url: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  deps: { fetchImpl?: typeof globalThis.fetch } = {},
): Promise<SiteProbe> {
  const startedAt = performance.now();
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "RepoDrop-Monitor/1.0 (+discord-bot)" },
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    // On lit le corps pour libérer la connexion (et capter un payload d'erreur).
    await res.text().catch(() => "");
    return {
      url,
      ok: res.ok,
      latencyMs,
      status: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
      checkedAt: Date.now(),
    };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const name = (e as Error)?.name ?? "";
    const message = (e as Error)?.message ?? String(e);
    return {
      url,
      ok: false,
      latencyMs,
      status: null,
      error:
        name === "TimeoutError"
          ? `délai dépassé (${timeoutMs} ms)`
          : message.slice(0, 160),
      checkedAt: Date.now(),
    };
  }
}

/** URL sondée par défaut : l'URL publique déclarée de l'application. */
export function resolveProbeUrl(settings: DiscordSettings): string {
  if (settings.probeUrl.trim()) return settings.probeUrl.trim();
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}/api/health`;
}

/* ------------------------------------------------------------------ état */

export interface MonitorStatus {
  running: boolean;
  configured: boolean;
  mode: "bot" | "webhook" | null;
  enabled: boolean;
  intervalMin: number;
  probeUrl: string;
  startedAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastOk: boolean | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  messagesSent: number;
  uptime24h: { total: number; ok: number; uptimePct: number | null; avgLatencyMs: number | null };
  bot: {
    connected: boolean;
    user: string | null;
    latencyMs: number | null;
    lastError: string | null;
    reconnects: number;
  };
}

interface MonitorState {
  timer: ReturnType<typeof setInterval> | null;
  firstProbe: ReturnType<typeof setTimeout> | null;
  bot: DiscordBot | null;
  deps: ClientDeps;
  running: boolean;
  startedAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastOk: boolean | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  messagesSent: number;
  inFlight: boolean;
  /** Premier tick : on sonde sans publier (évite le spam à chaque restart). */
  silent: boolean;
  tokenFingerprint: string;
  /** Nombre de sondes effectuées (déclenche la purge périodique). */
  ticks: number;
}

function newState(): MonitorState {
  return {
    timer: null,
    firstProbe: null,
    bot: null,
    deps: {},
    running: false,
    startedAt: null,
    nextRunAt: null,
    lastRunAt: null,
    lastOk: null,
    lastLatencyMs: null,
    lastError: null,
    consecutiveFailures: 0,
    messagesSent: 0,
    inFlight: false,
    silent: true,
    tokenFingerprint: "",
    ticks: 0,
  };
}

function state(): MonitorState {
  const g = globalThis as unknown as { __repodropMonitor?: MonitorState };
  if (!g.__repodropMonitor) g.__repodropMonitor = newState();
  return g.__repodropMonitor;
}

/** Empreinte du secret (jamais le secret lui-même) pour détecter un changement. */
function fingerprint(s: DiscordSettings): string {
  const t = s.token.trim();
  return `${isWebhookUrl(t) ? "webhook" : "bot"}:${t.length}:${t.slice(-4)}`;
}

function canSend(s: DiscordSettings): boolean {
  return Boolean(s.token.trim() && (isWebhookUrl(s.token) || s.channelId.trim()));
}

export function getMonitorStatus(): MonitorStatus {
  const st = state();
  const s = getDiscordSettings();
  return {
    running: st.running,
    configured: canSend(s),
    mode: s.token ? (isWebhookUrl(s.token) ? "webhook" : "bot") : null,
    enabled: s.enabled,
    intervalMin: s.intervalMin,
    probeUrl: resolveProbeUrl(s),
    startedAt: st.startedAt,
    nextRunAt: st.nextRunAt,
    lastRunAt: st.lastRunAt,
    lastOk: st.lastOk,
    lastLatencyMs: st.lastLatencyMs,
    lastError: st.lastError,
    consecutiveFailures: st.consecutiveFailures,
    messagesSent: st.messagesSent,
    uptime24h: pingStats(24 * 3_600_000),
    bot: st.bot
      ? {
          connected: st.bot.status.connected,
          user: st.bot.status.user,
          latencyMs: st.bot.status.latencyMs,
          lastError: st.bot.status.lastError,
          reconnects: st.bot.status.reconnects,
        }
      : { connected: false, user: null, latencyMs: null, lastError: null, reconnects: 0 },
  };
}

/* --------------------------------------------------------------- cycle de vie */

/** Démarre le moniteur si (et seulement si) il est activé et configuré. */
export function startMonitor(deps: ClientDeps = {}): MonitorStatus {
  const st = state();
  const s = getDiscordSettings();
  stopTimerOnly(st);

  if (!s.enabled || !canSend(s)) {
    st.running = false;
    st.startedAt = null;
    st.nextRunAt = null;
    st.tokenFingerprint = "";
    return getMonitorStatus();
  }

  st.deps = deps;
  st.running = true;
  st.startedAt = Date.now();
  st.silent = true;
  st.tokenFingerprint = fingerprint(s);

  // Bot : on ouvre la Gateway pour apparaître en ligne (webhook : rien à faire).
  if (!isWebhookUrl(s.token) && !st.bot) {
    const bot = new DiscordBot(s.token.trim(), {
      ...deps,
      logger: (m, e) => (e ? console.error(m, e) : console.log(m)),
    });
    bot.connect();
    st.bot = bot;
  }

  const periodMs = Math.max(1, s.intervalMin) * 60_000;
  st.nextRunAt = Date.now() + periodMs;
  st.timer = setInterval(() => void runTick(), periodMs);
  st.timer.unref?.();

  // Sonde immédiate (muette) : le panel affiche un état sans attendre 10 min.
  st.firstProbe = setTimeout(() => void runTick({ silent: true }), 4_000);
  st.firstProbe.unref?.();

  console.log(
    `[discord] moniteur démarré — ping toutes les ${s.intervalMin} min vers ${resolveProbeUrl(s)}`,
  );
  return getMonitorStatus();
}

/** Arrêt complet (timer + Gateway). */
export function stopMonitor(): MonitorStatus {
  const st = state();
  stopTimerOnly(st);
  if (st.bot) {
    st.bot.stop();
    st.bot = null;
  }
  st.running = false;
  st.startedAt = null;
  st.nextRunAt = null;
  st.tokenFingerprint = "";
  console.log("[discord] moniteur arrêté");
  return getMonitorStatus();
}

function stopTimerOnly(st: MonitorState): void {
  if (st.timer) clearInterval(st.timer);
  if (st.firstProbe) clearTimeout(st.firstProbe);
  st.timer = null;
  st.firstProbe = null;
}

/** Redémarrage après modification des réglages (jeton, canal, période…). */
export function restartMonitor(deps: ClientDeps = {}): MonitorStatus {
  const st = state();
  if (st.bot) {
    st.bot.stop();
    st.bot = null;
  }
  return startMonitor(deps);
}

/**
 * Initialisation paresseuse : appelée par `ensureWorkerInit()` (lib/jobs.ts).
 * Idempotente, comme le reste du worker.
 */
export function ensureDiscordMonitor(): void {
  const g = globalThis as unknown as { __repodropMonitorInit?: boolean };
  if (g.__repodropMonitorInit) return;
  g.__repodropMonitorInit = true;
  try {
    startMonitor();
  } catch (e) {
    console.error("[discord] démarrage impossible :", e);
  }
}

/* -------------------------------------------------------------------- tick */

export interface TickOutcome {
  probe: SiteProbe;
  sent: boolean;
  messageId?: string;
  error?: string | null;
}

/**
 * Un cycle complet : sonde → base → Discord.
 * `force` ignore la politique d'envoi (bouton « Ping maintenant » du panel).
 */
export async function runTick(
  opts: { silent?: boolean; force?: boolean } = {},
): Promise<TickOutcome> {
  const st = state();
  const s = getDiscordSettings();
  const silent = opts.silent ?? st.silent;
  st.silent = false;

  if (st.inFlight) {
    return {
      probe: {
        url: resolveProbeUrl(s),
        ok: false,
        latencyMs: null,
        status: null,
        error: "sonde précédente encore en cours",
        checkedAt: Date.now(),
      },
      sent: false,
    };
  }
  st.inFlight = true;

  const url = resolveProbeUrl(s);
  let probe: SiteProbe;
  try {
    probe = await probeSite(url, DEFAULT_PROBE_TIMEOUT_MS, st.deps);
  } finally {
    st.inFlight = false;
  }

  const wasDown = st.lastOk === false;
  const recovered = Boolean(wasDown && probe.ok);

  st.lastRunAt = probe.checkedAt;
  st.lastOk = probe.ok;
  st.lastLatencyMs = probe.latencyMs;
  st.lastError = probe.error;
  st.consecutiveFailures = probe.ok ? 0 : st.consecutiveFailures + 1;
  const periodMs = Math.max(1, s.intervalMin) * 60_000;
  st.nextRunAt = Date.now() + periodMs;

  recordPing({
    ok: probe.ok,
    latencyMs: probe.latencyMs,
    status: probe.status,
    error: probe.error,
  });

  // Rétention : 7 jours de sondes suffisent (nettoyage toutes les 24 sondes).
  st.ticks += 1;
  if (st.ticks % 24 === 0) {
    try {
      prunePings();
    } catch {
      /* ignore */
    }
  }

  if (!st.running) return { probe, sent: false };

  // Politique d'envoi.
  const shouldSend =
    !silent &&
    canSend(s) &&
    (opts.force === true ||
      (probe.ok && s.heartbeat) ||
      (!probe.ok && s.alertOnDown) ||
      recovered);
  if (!shouldSend) return { probe, sent: false };

  const stats = activityStats();
  const uptime = pingStats(24 * 3_600_000);
  const payload = buildHeartbeatPayload(
    {
      probe,
      intervalMin: s.intervalMin,
      uptimePct: uptime.uptimePct,
      avgLatencyMs: uptime.avgLatencyMs,
      pushes24h: stats.pushes24h,
      recovered,
    },
    s.roleMention,
  );

  try {
    const sent: SentMessage = await sendMessage(s.token, s.channelId, payload, st.deps);
    st.messagesSent++;
    st.lastError = null;
    return { probe, sent: true, messageId: sent.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    st.lastError = msg;
    console.error("[discord] envoi du ping impossible :", msg);
    logEvent({
      kind: "discord",
      detail: { action: "heartbeat", ok: false, error: msg.slice(0, 300) },
    });
    return { probe, sent: false, error: msg };
  }
}

/* ------------------------------------------------------- annonce des push */

/**
 * Annonce un push sur Discord (appelé par lib/jobs.ts après chaque push).
 * N'échoue jamais : une panne Discord ne doit pas casser un import.
 */
export async function announcePush(info: PushEventInfo): Promise<boolean> {
  try {
    const s = getDiscordSettings();
    if (!s.enabled || !s.notifyPush || !canSend(s)) return false;
    await sendMessage(s.token, s.channelId, buildPushPayload(info), state().deps);
    state().messagesSent++;
    return true;
  } catch (e) {
    console.error(
      "[discord] annonce de push impossible :",
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

/** Message de test envoyé depuis le panel staff. */
export async function sendTestMessage(
  who: string,
  deps: ClientDeps = {},
): Promise<void> {
  const s = getDiscordSettings();
  if (!canSend(s)) {
    throw new Error("Renseignez d'abord le jeton (ou le webhook) et le canal.");
  }
  const { buildTestPayload } = await import("./messages");
  await sendMessage(s.token, s.channelId, buildTestPayload(who), {
    ...state().deps,
    ...deps,
  });
}
