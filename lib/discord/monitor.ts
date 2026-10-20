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
  DEFAULT_INTERVAL_MIN,
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
  /** Depuis quand la sonde en cours tourne (anti-blocage, cf. runTick). */
  inFlightSince: number | null;
  /**
   * Identifiant de la sonde en cours. Une sonde « orpheline » (blocage
   * d'origine) rendue tardivement ne doit pas libérer le verrou d'une sonde
   * plus récente : seule la dernière lancée a le droit de libérer l'état.
   */
  probeSeq: number;
  /** Premier tick : on sonde sans publier (évite le spam à chaque restart). */
  silent: boolean;
  tokenFingerprint: string;
  /** Nombre de sondes effectuées (déclenche la purge périodique). */
  ticks: number;
  /** Dernier contrôle automatique de santé (ensureDiscordMonitor). */
  lastHealAt: number;
  /** Arrêt explicite depuis le panel : l'auto-réparation ne doit pas relancer. */
  manualStop: boolean;
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
    inFlightSince: null,
    probeSeq: 0,
    silent: true,
    tokenFingerprint: "",
    ticks: 0,
    lastHealAt: 0,
    manualStop: false,
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
  // Base potentiellement indisponible : le panel doit continuer à s'afficher
  // (un plantage ici figerait son rafraîchissement pour rien).
  let s: DiscordSettings;
  try {
    s = getDiscordSettings();
  } catch {
    s = {
      enabled: false,
      token: "",
      channelId: "",
      intervalMin: DEFAULT_INTERVAL_MIN,
      heartbeat: true,
      notifyPush: true,
      alertOnDown: true,
      probeUrl: "",
      roleMention: "",
    };
  }
  let uptime: MonitorStatus["uptime24h"];
  try {
    uptime = pingStats(24 * 3_600_000);
  } catch {
    uptime = { total: 0, ok: 0, uptimePct: null, avgLatencyMs: null };
  }
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
    uptime24h: uptime,
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
  st.manualStop = false;
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
  // `void runTick()` sans .catch : la moindre exception imprévue deviendrait
  // une unhandled rejection — ce qui FERME le process Node entier. Le tick est
  // blindé en interne, ce catch est le filet de sécurité double.
  const tick = (opts?: { silent?: boolean }): void => {
    void runTick(opts).catch((e) => {
      console.error("[discord] tick en échec :", e instanceof Error ? e.message : e);
    });
  };
  st.timer = setInterval(() => tick(), periodMs);
  st.timer.unref?.();

  // Sonde immédiate (muette) : le panel affiche un état sans attendre 10 min.
  st.firstProbe = setTimeout(() => tick({ silent: true }), 4_000);
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
  // Arrêt demandé par l'utilisateur : l'auto-réparation (ensureDiscordMonitor)
  // ne doit pas le défaire. Un redémarrage explicite (panel / réglages) le
  // remet à false dans startMonitor().
  st.manualStop = true;
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
 * Intervalle minimal entre deux contrôles de santé automatiques : le moniteur
 * est vérifié à chaque requête (`ensureWorkerInit`), mais au plus une fois
 * toutes les 30 s pour ne pas relire les réglages à chaque appel.
 */
const HEAL_INTERVAL_MS = 30_000;

/**
 * Initialisation + **auto-réparation** : appelée par `ensureWorkerInit()`
 * (lib/jobs.ts) sur chaque requête, bridée à une vérification toutes les 30 s.
 *
 * À l'ancienne, un simple drapeau `__repodropMonitorInit` faisait un seul
 * essai de démarrage par process : si cet essai échouait (base pas encore
 * prête, jeton configuré plus tard, timer perdu lors d'un rechargement de
 * module…), plus jamais rien ne relançait le moniteur — « 2 ou 3 pings puis
 * ça s'arrête ». Maintenant :
 *  - démarre le moniteur dès qu'il est activé + configuré ;
 *  - relance si le timer a disparu ou si le démarrage initial a échoué ;
 *  - respecte un arrêt explicite depuis le panel (`manualStop`) ;
 *  - expose une erreur lisible si le jeton est devenu illisible
 *    (SESSION_SECRET absent/changé : le chiffré en base ne s'ouvre plus).
 */
export function ensureDiscordMonitor(): void {
  const st = state();
  const now = Date.now();
  if (now - st.lastHealAt < HEAL_INTERVAL_MS) return;
  st.lastHealAt = now;
  try {
    const s = getDiscordSettings();
    if (s.enabled && canSend(s)) {
      if (st.manualStop) return;
      if (!st.running || !st.timer) {
        console.warn(
          "[discord] moniteur absent : démarrage/relance automatique",
        );
        startMonitor(st.deps);
      }
      return;
    }
    if (s.enabled && !canSend(s)) {
      const msg =
        "Bot activé mais non configuré : jeton Discord absent ou illisible " +
        "(SESSION_SECRET changé ?). Ressaisissez-le dans le panel staff.";
      if (st.lastError !== msg) {
        st.lastError = msg;
        console.error("[discord]", msg);
        logEvent({
          kind: "discord",
          detail: { action: "heal", ok: false, error: msg },
        });
      }
      return;
    }
    // Désactivé : rien à faire (l'activation passe par le panel, qui
    // redémarre le moniteur lui-même via restartMonitor).
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    st.lastError = `Réglages Discord illisibles : ${msg}`.slice(0, 200);
    console.error("[discord] réglages illisibles :", msg);
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
 *
 * **Ne rejette jamais** : toute exception interne (base indisponible, stats,
 * réglages illisibles…) est convertie en probe/erreur. Le timer du moniteur
 * appelle ce tick via `void …` : une rejection non attrapée tuerait le
 * process Node entier, et le moniteur avec.
 */
export async function runTick(
  opts: { silent?: boolean; force?: boolean } = {},
): Promise<TickOutcome> {
  const st = state();
  try {
    return await runTickGuarded(opts, st);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // InFlight n'est pas touché ici : le `finally` de la sonde en cours (le
    // sien ou celui d'un tick concurrent) fait déjà ce travail correctement.
    st.lastError = msg;
    console.error("[discord] tick en échec :", msg);
    try {
      logEvent({
        kind: "discord",
        detail: { action: "tick", ok: false, error: msg.slice(0, 300) },
      });
    } catch {
      /* journal indisponible : rien de plus à faire */
    }
    let url = "";
    try {
      url = resolveProbeUrl(getDiscordSettings());
    } catch {
      /* settings indisponibles : l'URL restera vide */
    }
    return {
      probe: {
        url,
        ok: false,
        latencyMs: null,
        status: null,
        error: msg,
        checkedAt: Date.now(),
      },
      sent: false,
      error: msg,
    };
  }
}

async function runTickGuarded(
  opts: { silent?: boolean; force?: boolean },
  st: MonitorState,
): Promise<TickOutcome> {
  const s = getDiscordSettings();
  const silent = opts.silent ?? st.silent;
  st.silent = false;

  if (st.inFlight) {
    const stuckMs =
      st.inFlightSince !== null ? Date.now() - st.inFlightSince : Infinity;
    // Une sonde ne peut légalement pas dépasser le timeout + marge : passé ce
    // délai, elle est « orpheline » (fetch qui n'a jamais tenu son abort) et on
    // relance. Sans ce garde-fou, un seul blocage gelait définitivement le
    // moniteur ET le bouton « Ping maintenant ».
    if (stuckMs < DEFAULT_PROBE_TIMEOUT_MS + 15_000) {
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
    console.warn(
      `[discord] sonde bloquée depuis ${Math.round(stuckMs / 1000)} s : relance forcée`,
    );
    // Pas de remise à zéro ici : on prend le verrou avec un nouvel identifiant,
    // l'ancienne sonde (si elle termine un jour) ne libérera que la sienne.
  }

  const probeId = ++st.probeSeq;
  st.inFlight = true;
  st.inFlightSince = Date.now();
  let probe: SiteProbe;
  try {
    const url = resolveProbeUrl(s);
    probe = await probeSite(url, DEFAULT_PROBE_TIMEOUT_MS, st.deps);
  } finally {
    if (st.probeSeq === probeId) {
      st.inFlight = false;
      st.inFlightSince = null;
    }
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
