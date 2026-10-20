/**
 * Tests du bot Discord : construction des messages, routage webhook/bot,
 * poignée de main Gateway (avec un faux WebSocket) et cycle du moniteur.
 *
 * Aucun accès réseau : `fetch` et `WebSocket` sont injectés.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Base et secret de session dédiés aux tests (lus paresseusement par lib/db).
const TMP = path.join(os.tmpdir(), `rd-discord-${process.pid}`);
process.env.DB_PATH = path.join(TMP, "test.db");
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

import {
  buildHeartbeatPayload,
  buildPushPayload,
  buildTestPayload,
  COLORS,
} from "@/lib/discord/messages";
import {
  DiscordApiError,
  DiscordBot,
  fetchBotUser,
  sendMessage,
  type SocketLike,
} from "@/lib/discord/client";
import {
  announcePush,
  getMonitorStatus,
  probeSite,
  runTick,
  startMonitor,
  stopMonitor,
} from "@/lib/discord/monitor";
import { updateDiscordSettings } from "@/lib/settings";

beforeAll(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});

afterAll(async () => {
  stopMonitor();
  await fsp.rm(TMP, { recursive: true, force: true });
});

afterEach(() => {
  stopMonitor();
});

/* ------------------------------------------------------------- faux réseau */

interface Call {
  url: string;
  init?: RequestInit;
  body?: unknown;
}

function fakeFetch(responder: (url: string) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const impl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, init, body });
    const r = responder(url);
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 1;
  sent: { op: number; d?: unknown }[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as { op: number; d?: unknown });
  }

  close(): void {
    this.onclose?.({ code: 1000 });
  }

  /** Simule une trame reçue du serveur. */
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  ops(op: number): { op: number; d?: unknown }[] {
    return this.sent.filter((m) => m.op === op);
  }
}

/* ---------------------------------------------------------------- messages */

describe("messages Discord", () => {
  const baseProbe = {
    url: "https://exemple.test/api/health",
    ok: true,
    latencyMs: 42,
    status: 200,
    error: null,
    checkedAt: Date.parse("2026-03-20T14:00:00Z"),
  };

  it("publie un état « en ligne » sans mention quand tout va bien", () => {
    const payload = buildHeartbeatPayload({
      probe: baseProbe,
      intervalMin: 10,
      uptimePct: 99.8,
      avgLatencyMs: 45,
      pushes24h: 3,
    });
    expect(payload.content).toBeUndefined();
    expect(payload.embeds[0].color).toBe(COLORS.ok);
    expect(payload.embeds[0].title).toContain("en ligne");
    const latence = payload.embeds[0].fields?.find((f) => f.name === "Latence");
    expect(latence?.value).toBe("42 ms");
  });

  it("mentionne le rôle et passe au rouge quand le site ne répond plus", () => {
    const payload = buildHeartbeatPayload(
      {
        probe: { ...baseProbe, ok: false, status: null, latencyMs: null, error: "délai dépassé" },
        intervalMin: 10,
        uptimePct: 92,
        avgLatencyMs: null,
        pushes24h: 0,
      },
      "@here",
    );
    expect(payload.content).toBe("@here");
    expect(payload.embeds[0].color).toBe(COLORS.down);
    expect(payload.embeds[0].title).toContain("ne répond plus");
  });

  it("signale le retour après panne", () => {
    const payload = buildHeartbeatPayload({
      probe: baseProbe,
      intervalMin: 10,
      uptimePct: 99,
      avgLatencyMs: 40,
      pushes24h: 1,
      recovered: true,
    });
    expect(payload.embeds[0].title).toContain("de retour");
  });

  it("décrit un push réussi avec dépôt, branche et commit", () => {
    const payload = buildPushPayload({
      login: "alice",
      ok: true,
      repo: "alice/mon-projet",
      branch: "main",
      sha: "abcdef1234567890",
      files: 12,
      bytes: 2048,
      filename: "projet.tar",
      at: baseProbe.checkedAt,
    });
    const embed = payload.embeds[0];
    expect(embed.url).toBe("https://github.com/alice/mon-projet/tree/main");
    expect(embed.color).toBe(COLORS.ok);
    expect(embed.fields?.map((f) => f.value)).toEqual(
      expect.arrayContaining(["alice", "alice/mon-projet", "main", "`abcdef1`", "12", "2 Ko"]),
    );
  });

  it("remonte l'erreur d'un push échoué", () => {
    const payload = buildPushPayload({
      login: "bob",
      ok: false,
      error: "Le push vers GitHub a échoué.",
      at: baseProbe.checkedAt,
    });
    const embed = payload.embeds[0];
    expect(embed.color).toBe(COLORS.warn);
    expect(embed.fields?.some((f) => f.name === "Erreur")).toBe(true);
  });

  it("construit un message de test", () => {
    const payload = buildTestPayload("carole");
    expect(payload.embeds[0].title).toContain("connecté");
    expect(payload.embeds[0].fields?.[0].value).toBe("carole");
  });
});

/* -------------------------------------------------------------- routage REST */

describe("sendMessage", () => {
  it("passe par le webhook quand le secret est une URL", async () => {
    const { calls, impl } = fakeFetch(() => ({ status: 200, body: { id: "1" } }));
    await sendMessage(
      "https://discord.com/api/webhooks/1234/abcd",
      "",
      { embeds: [] },
      { fetchImpl: impl },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://discord.com/api/webhooks/1234/abcd");
  });

  it("passe par l'API bot avec l'en-tête Authorization sinon", async () => {
    const { calls, impl } = fakeFetch(() => ({ status: 200, body: { id: "2" } }));
    await sendMessage(
      "MTok.faux.jeton",
      "987654321",
      { content: "salut", embeds: [] },
      { fetchImpl: impl },
    );
    expect(calls[0].url).toBe("https://discord.com/api/v10/channels/987654321/messages");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bot MTok.faux.jeton");
    // Un bot ne doit pas envoyer username/avatar_url (réservé aux webhooks).
    expect(calls[0].body).toEqual({ content: "salut", embeds: [] });
  });

  it("refuse d'envoyer sans canal configuré", async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: {} }));
    await expect(
      sendMessage("MTok.faux.jeton", "", { embeds: [] }, { fetchImpl: impl }),
    ).rejects.toThrow(/canal/i);
  });

  it("transforme un 401 de /users/@me en erreur explicite", async () => {
    const { impl } = fakeFetch(() => ({ status: 401, body: { message: "401: Unauthorized" } }));
    await expect(fetchBotUser("mauvais", { fetchImpl: impl })).rejects.toBeInstanceOf(
      DiscordApiError,
    );
  });
});

/* ------------------------------------------------------------------- sonde */

describe("probeSite", () => {
  it("mesure la latence d'une réponse 200", async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    const probe = await probeSite("https://exemple.test/api/health", 5000, {
      fetchImpl: impl,
    });
    expect(probe.ok).toBe(true);
    expect(probe.status).toBe(200);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("signale une réponse 503", async () => {
    const { impl } = fakeFetch(() => ({ status: 503, body: { ok: false } }));
    const probe = await probeSite("https://exemple.test/api/health", 5000, {
      fetchImpl: impl,
    });
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("HTTP 503");
  });

  it("signale une erreur réseau", async () => {
    const impl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const probe = await probeSite("https://inexistant.test/api/health", 5000, {
      fetchImpl: impl,
    });
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain("ENOTFOUND");
  });
});

/* ----------------------------------------------------------------- gateway */

describe("DiscordBot (Gateway)", () => {
  it("s'identifie après HELLO et devient « connecté » au READY", () => {
    const bot = new DiscordBot("MTok.test", { socketCtor: FakeSocket });
    bot.connect();
    const sock = FakeSocket.instances.at(-1)!;

    expect(sock.url).toContain("gateway.discord.gg");

    sock.receive({ op: 10, d: { heartbeat_interval: 41250 } });
    const identify = sock.ops(2)[0];
    expect(identify?.d).toMatchObject({
      token: "MTok.test",
      intents: 0,
      properties: { browser: "repodrop" },
    });

    sock.receive({ op: 0, t: "READY", s: 1, d: { user: { username: "RepoDrop" } } });
    expect(bot.status.connected).toBe(true);
    expect(bot.status.user).toBe("RepoDrop");
    expect(bot.status.lastError).toBeNull();

    bot.stop();
    expect(bot.status.connected).toBe(false);
  });

  it("répond à une demande de heartbeat et mesure la latence", () => {
    const bot = new DiscordBot("MTok.test", { socketCtor: FakeSocket });
    bot.connect();
    const sock = FakeSocket.instances.at(-1)!;
    sock.receive({ op: 10, d: { heartbeat_interval: 41250 } });
    sock.receive({ op: 0, t: "READY", s: 7, d: { user: { username: "b" } } });

    sock.receive({ op: 1, d: null }); // le serveur demande un battement
    const hb = sock.ops(1).at(-1);
    expect(hb?.d).toBe(7); // seq courant

    sock.receive({ op: 11, d: null }); // ACK
    expect(bot.status.latencyMs).not.toBeNull();

    bot.stop();
  });

  it("compte une reconnexion après fermeture inattendue", () => {
    const bot = new DiscordBot("MTok.test", { socketCtor: FakeSocket });
    bot.connect();
    const sock = FakeSocket.instances.at(-1)!;
    sock.onclose?.({ code: 1006 });
    expect(bot.status.reconnects).toBe(1);
    expect(bot.status.lastError).toContain("1006");
    bot.stop();
  });

  it("s'arrête définitivement si le jeton est refusé (4004)", () => {
    const bot = new DiscordBot("MTok.mauvais", { socketCtor: FakeSocket });
    bot.connect();
    const sock = FakeSocket.instances.at(-1)!;
    sock.onclose?.({ code: 4004 });
    expect(bot.status.lastError).toContain("4004");
    expect(bot.status.reconnects).toBe(0);
    bot.stop();
  });
});

/* ---------------------------------------------------------------- moniteur */

const WEBHOOK = "https://discord.com/api/webhooks/4242/secret";

describe("moniteur Discord", () => {
  it("sonde le site et publie l'état quand on force un ping", async () => {
    updateDiscordSettings({
      enabled: true,
      token: WEBHOOK,
      intervalMin: 10,
      heartbeat: true,
      probeUrl: "https://exemple.test/api/health",
    });
    const { calls, impl } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    startMonitor({ fetchImpl: impl });

    const outcome = await runTick({ silent: false, force: true });

    expect(outcome.probe.ok).toBe(true);
    expect(outcome.sent).toBe(true);
    const webhookCall = calls.find((c) => c.url.includes("/api/webhooks/"));
    expect(webhookCall).toBeDefined();
    const body = webhookCall?.body as { embeds?: { title?: string }[] };
    expect(body.embeds?.[0].title).toContain("Ping RepoDrop");

    const status = getMonitorStatus();
    expect(status.running).toBe(true);
    expect(status.mode).toBe("webhook");
    expect(status.messagesSent).toBeGreaterThan(0);
  });

  it("n'envoie rien quand le bot est désactivé", async () => {
    updateDiscordSettings({ enabled: false });
    const { calls, impl } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    startMonitor({ fetchImpl: impl });
    const outcome = await runTick({ silent: false, force: true });
    expect(outcome.sent).toBe(false);
    expect(calls.filter((c) => c.url.includes("/api/webhooks/"))).toHaveLength(0);
  });

  it("annonce un push quand l'option est activée", async () => {
    updateDiscordSettings({
      enabled: true,
      token: WEBHOOK,
      notifyPush: true,
      probeUrl: "https://exemple.test/api/health",
    });
    const { calls, impl } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    startMonitor({ fetchImpl: impl });

    const sent = await announcePush({
      login: "alice",
      ok: true,
      repo: "alice/projet",
      branch: "main",
      sha: "abc1234",
      files: 3,
      bytes: 1024,
      at: Date.now(),
    });

    expect(sent).toBe(true);
    const body = calls.find((c) => c.url.includes("/api/webhooks/"))?.body as {
      embeds?: { title?: string }[];
    };
    expect(body.embeds?.[0].title).toContain("poussé");
  });

  it("reste silencieux sur un push si l'annonce est coupée", async () => {
    updateDiscordSettings({ enabled: true, token: WEBHOOK, notifyPush: false });
    const { calls, impl } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    startMonitor({ fetchImpl: impl });
    const sent = await announcePush({ login: "alice", ok: true, at: Date.now() });
    expect(sent).toBe(false);
    expect(calls.filter((c) => c.url.includes("/api/webhooks/"))).toHaveLength(0);
  });

  it("enregistre l'échec de la sonde sans lever d'exception", async () => {
    updateDiscordSettings({
      enabled: true,
      token: WEBHOOK,
      alertOnDown: true,
      heartbeat: false,
      probeUrl: "https://hs.test/api/health",
    });
    // Le site répond 503, mais l'envoi Discord, lui, fonctionne.
    const { calls, impl } = fakeFetch((url) =>
      url.includes("/api/webhooks/")
        ? { status: 200, body: { id: "9" } }
        : { status: 503, body: { ok: false } },
    );
    startMonitor({ fetchImpl: impl });

    const outcome = await runTick({ silent: false });

    expect(outcome.probe.ok).toBe(false);
    // alertOnDown actif → message d'alerte quand même.
    expect(outcome.sent).toBe(true);
    const body = calls.find((c) => c.url.includes("/api/webhooks/"))?.body as {
      embeds?: { title?: string; color?: number }[];
    };
    expect(body.embeds?.[0].color).toBe(COLORS.down);
  });
});
