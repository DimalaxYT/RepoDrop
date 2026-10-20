/**
 * Client Discord minimaliste — zéro dépendance externe.
 *
 * Deux façons d'envoyer un message :
 *  - **webhook** : une URL suffit (`https://discord.com/api/webhooks/…`) ;
 *  - **bot** : un jeton de bot. Les messages partent en REST
 *    (`POST /channels/:id/messages`) et une connexion Gateway est ouverte en
 *    parallèle pour que le bot apparaisse **en ligne** sur le serveur et pour
 *    remonter sa latence au panel staff.
 *
 * Tout est injectable (`fetchImpl`, `WebSocketImpl`) : les tests pilotent un
 * faux WebSocket et un faux fetch, sans jamais toucher à discord.com.
 */
import { isWebhookUrl } from "../settings";
import type { DiscordPayload } from "./messages";

export const DISCORD_API = "https://discord.com/api/v10";
export const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

type FetchImpl = typeof globalThis.fetch;

/** Sous-ensemble de WebSocket suffisant pour la Gateway Discord. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export type SocketCtor = new (url: string) => SocketLike;

export interface ClientDeps {
  fetchImpl?: FetchImpl;
  socketCtor?: SocketCtor;
  /** Pour les tests : horloge et délais raccourcis. */
  now?: () => number;
  logger?: (msg: string, err?: unknown) => void;
}

export class DiscordApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
  }
}

function getFetch(deps: ClientDeps): FetchImpl {
  const f = deps.fetchImpl ?? globalThis.fetch;
  if (!f) throw new DiscordApiError("fetch indisponible sur ce runtime", 0);
  return f;
}

/**
 * Enrobe un appel fetch vers Discord : une erreur réseau (`fetch failed`,
 * DNS, TLS, timeout) devient un message actionnable plutôt qu'un libellé
 * cryptique dans le panel staff.
 */
async function discordFetch(
  deps: ClientDeps,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await getFetch(deps)(url, init);
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    if (name === "TimeoutError") {
      throw new DiscordApiError("Discord n'a pas répondu à temps (15 s).", 0);
    }
    throw new DiscordApiError(
      "Discord est injoignable depuis le serveur (sortie réseau vers discord.com ?).",
      0,
    );
  }
}

/* ------------------------------------------------------------------- REST */

export interface SentMessage {
  id: string;
  channelId: string;
}

/** Envoie un message via un webhook (aucun jeton nécessaire). */
export async function sendWebhook(
  webhookUrl: string,
  payload: DiscordPayload,
  deps: ClientDeps = {},
): Promise<SentMessage> {
  const res = await discordFetch(deps, webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new DiscordApiError(
      `Webhook Discord : HTTP ${res.status}${res.status === 404 ? " (URL invalide ou supprimée)" : ""}`,
      res.status,
    );
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? "", channelId: "webhook" };
}

/** Envoie un message avec un jeton de bot. */
export async function sendBotMessage(
  token: string,
  channelId: string,
  payload: DiscordPayload,
  deps: ClientDeps = {},
): Promise<SentMessage> {
  const res = await discordFetch(
    deps,
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${token}`,
      },
      // Un bot n'a pas le droit de poser `username`/`avatar_url` (webhook only).
      body: JSON.stringify({ content: payload.content, embeds: payload.embeds }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new DiscordApiError(
      `Discord : HTTP ${res.status}${body?.message ? ` — ${body.message}` : ""}`,
      res.status,
    );
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? "", channelId };
}

/** Point d'entrée unique : webhook ou bot selon la forme du secret. */
export async function sendMessage(
  secret: string,
  channelId: string,
  payload: DiscordPayload,
  deps: ClientDeps = {},
): Promise<SentMessage> {
  if (isWebhookUrl(secret)) return sendWebhook(secret.trim(), payload, deps);
  if (!channelId) {
    throw new DiscordApiError("Aucun canal Discord configuré.", 0);
  }
  return sendBotMessage(secret.trim(), channelId, payload, deps);
}

/** `GET /users/@me` : valide le jeton et renvoie l'identité du bot. */
export async function fetchBotUser(
  token: string,
  deps: ClientDeps = {},
): Promise<{ id: string; username: string }> {
  const res = await discordFetch(deps, `${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new DiscordApiError(
      res.status === 401
        ? "Jeton Discord refusé (401). Vérifiez le jeton du bot."
        : `Discord : HTTP ${res.status}`,
      res.status,
    );
  }
  const data = (await res.json()) as { id?: string; username?: string };
  return { id: data.id ?? "", username: data.username ?? "bot" };
}

/** `GET /channels/:id` : valide le canal et vérifie qu'on peut y écrire. */
export async function fetchChannel(
  token: string,
  channelId: string,
  deps: ClientDeps = {},
): Promise<{ id: string; name: string }> {
  const res = await discordFetch(
    deps,
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}`,
    {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new DiscordApiError(
      res.status === 403
        ? "Le bot n'a pas accès à ce canal (permissions ou serveur différent)."
        : res.status === 404
          ? "Canal introuvable : vérifiez l'identifiant (mode développeur → copier l'ID)."
          : `Discord : HTTP ${res.status}`,
      res.status,
    );
  }
  const data = (await res.json()) as { id?: string; name?: string };
  return { id: data.id ?? channelId, name: data.name ?? "canal" };
}

/* ---------------------------------------------------------------- Gateway */

export interface BotStatus {
  connected: boolean;
  /** Identifiant de session Gateway (null tant que READY n'est pas reçu). */
  user: string | null;
  /** Latence mesurée par les heartbeats (ms). */
  latencyMs: number | null;
  lastError: string | null;
  reconnects: number;
  /** Dernière transition d'état. */
  since: number | null;
}

interface GatewayHello {
  heartbeat_interval: number;
}

/**
 * Connexion Gateway Discord (opcode HELLO / IDENTIFY / HEARTBEAT / DISPATCH).
 * Ne sert qu'à maintenir le bot « en ligne » et à mesurer la latence : les
 * messages passent par le REST, qui fonctionne même sans Gateway.
 */
export class DiscordBot {
  readonly token: string;
  private deps: ClientDeps;
  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private seq: number | null = null;
  private lastSentAt = 0;
  private awaitingAck = false;
  private attempts = 0;
  private stopped = true;
  private _status: BotStatus = {
    connected: false,
    user: null,
    latencyMs: null,
    lastError: null,
    reconnects: 0,
    since: null,
  };

  constructor(token: string, deps: ClientDeps = {}) {
    this.token = token;
    this.deps = deps;
  }

  get status(): BotStatus {
    return { ...this._status };
  }

  private log(msg: string, err?: unknown): void {
    this.deps.logger?.(`[discord] ${msg}`, err);
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = null;
    this.retry = null;
    try {
      this.socket?.close(1000, "stop");
    } catch {
      /* ignore */
    }
    this.socket = null;
    this._status.connected = false;
  }

  private open(): void {
    if (this.stopped) return;
    const Ctor =
      this.deps.socketCtor ??
      (globalThis.WebSocket as unknown as SocketCtor | undefined);
    if (!Ctor) {
      this._status.lastError = "WebSocket indisponible sur ce runtime";
      return;
    }
    let socket: SocketLike;
    try {
      socket = new Ctor(GATEWAY_URL);
    } catch (e) {
      this.scheduleRetry(String(e));
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.log("gateway ouverte");
    };

    socket.onmessage = (ev) => this.onMessage(ev?.data);

    socket.onerror = () => {
      // `onclose` suit toujours : la reconnexion est gérée là.
      this.log("erreur gateway");
    };

    socket.onclose = (ev) => {
      const code = (ev as { code?: number } | undefined)?.code ?? 0;
      this._status.connected = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      // 4004 = jeton invalide : inutile d'insister.
      if (code === 4004 || code === 4010 || code === 4011 || code === 4012 || code === 4013) {
        this._status.lastError = `Gateway Discord : connexion refusée (code ${code})`;
        this.stopped = true;
        return;
      }
      this.scheduleRetry(`fermée (code ${code})`);
    };
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return;
    this.attempts++;
    this._status.lastError = reason;
    this._status.reconnects = this.attempts;
    // Backoff exponentiel borné : 1 s, 2 s, 4 s … 60 s max.
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.attempts - 1, 6));
    this.retry = setTimeout(() => this.open(), delay);
    this.retry.unref?.();
  }

  private onMessage(raw: unknown): void {
    let msg: { op: number; d: unknown; s: number | null; t: string | null };
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (typeof msg.s === "number") this.seq = msg.s;

    switch (msg.op) {
      case 10: {
        // HELLO : on cale le heartbeat puis on s'identifie.
        const hello = msg.d as GatewayHello;
        const interval = Math.max(5_000, hello?.heartbeat_interval ?? 41_250);
        this.startHeartbeat(interval);
        this.send({
          op: 2,
          d: {
            token: this.token,
            intents: 0, // aucun événement à écouter : on ne fait qu'exister
            properties: { os: "linux", browser: "repodrop", device: "repodrop" },
          },
        });
        break;
      }
      case 11: {
        // HEARTBEAT_ACK : la latence aller-retour.
        this.awaitingAck = false;
        if (this.lastSentAt) {
          this._status.latencyMs = Date.now() - this.lastSentAt;
        }
        break;
      }
      case 1: {
        // Le serveur demande un heartbeat immédiat.
        this.sendHeartbeat();
        break;
      }
      case 7: {
        // RECONNECT demandé.
        try {
          this.socket?.close(4000, "reconnect");
        } catch {
          /* ignore */
        }
        break;
      }
      case 9: {
        // INVALID_SESSION : on repart de zéro.
        this.seq = null;
        try {
          this.socket?.close(4000, "invalid session");
        } catch {
          /* ignore */
        }
        break;
      }
      case 0: {
        if (msg.t === "READY") {
          const d = msg.d as { user?: { username?: string } } | null;
          this._status.connected = true;
          this._status.user = d?.user?.username ?? "bot";
          this._status.lastError = null;
          this._status.since = Date.now();
          this.attempts = 0;
          this.log(`prêt (${this._status.user})`);
        }
        break;
      }
      default:
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.timer) clearInterval(this.timer);
    // Premier battement décalé (jitter) comme le recommande Discord.
    const jitter = Math.floor(Math.random() * Math.min(5_000, intervalMs));
    const first = setTimeout(() => {
      this.sendHeartbeat();
      this.timer = setInterval(() => this.beat(), intervalMs);
      this.timer.unref?.();
    }, jitter);
    first.unref?.();
  }

  private beat(): void {
    // Pas d'ACK sur le battement précédent = connexion zombie → on reconnecte.
    if (this.awaitingAck) {
      this.log("heartbeat sans ACK : reconnexion");
      try {
        this.socket?.close(4000, "zombie");
      } catch {
        /* ignore */
      }
      return;
    }
    this.sendHeartbeat();
  }

  private sendHeartbeat(): void {
    this.awaitingAck = true;
    this.lastSentAt = Date.now();
    this.send({ op: 1, d: this.seq });
  }

  private send(payload: unknown): void {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch (e) {
      this.log("envoi gateway impossible", e);
    }
  }
}
