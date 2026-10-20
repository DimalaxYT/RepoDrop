/**
 * Résilience du système de bot : « ça ping 2-3 fois puis ça s'arrête » ne
 * doit plus être possible.
 *
 * - `runTick` ne rejette JAMAIS, même quand la base est en panne (une
 *   rejection deviendrait une unhandled rejection → process Node tué) ;
 * - une sonde bloquée est remplacée par un garde-fou au lieu de geler
 *   définitivement le moniteur ET le bouton « Ping maintenant » ;
 * - `ensureDiscordMonitor` relance le moniteur si son timer a disparu ou si
 *   le premier démarrage avait échoué (jeton configuré plus tard) ;
 * - un arrêt explicite depuis le panel reste respecté ;
 * - un jeton devenu illisible (SESSION_SECRET changé) produit une erreur
 *   lisible dans le panel au lieu d'un arrêt silencieux ;
 * - Gateway : le timer du premier battement est annulé à l'arrêt, et la
 *   reconnexion a lieu même si `close()` du socket ne remonte aucun event.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP = path.join(os.tmpdir(), `rd-resilience-${process.pid}`);
process.env.DB_PATH = path.join(TMP, "resilience.db");
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

import { DiscordBot, type SocketLike } from "@/lib/discord/client";
import {
  ensureDiscordMonitor,
  getMonitorStatus,
  runTick,
  startMonitor,
  stopMonitor,
} from "@/lib/discord/monitor";
import { setSettingRaw } from "@/lib/db";
import { updateDiscordSettings } from "@/lib/settings";

const WEBHOOK = "https://discord.com/api/webhooks/4242/secret";

beforeAll(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});

afterEach(() => {
  stopMonitor();
  vi.useRealTimers();
});

/* ------------------------------------------------- état interne (blanc) */

interface MonState {
  timer: ReturnType<typeof setInterval> | null;
  firstProbe: ReturnType<typeof setTimeout> | null;
  deps: { fetchImpl?: typeof globalThis.fetch };
  running: boolean;
  inFlight: boolean;
  inFlightSince: number | null;
  probeSeq: number;
  manualStop: boolean;
  lastHealAt: number;
  lastError: string | null;
}

/** Accès blanc à l'état singleton du moniteur (créé au besoin). */
function st(): MonState {
  getMonitorStatus(); // state() est paresseux : le crée si absent
  return (globalThis as unknown as { __repodropMonitor: MonState })
    .__repodropMonitor;
}

/** Expire le throttle d'auto-réparation pour tester ensureDiscordMonitor. */
function expireHeal(): void {
  st().lastHealAt = 0;
}

/** Le timer de sonde de démarrage (4 s) n'a rien à faire dans ces tests. */
function silenceTimers(): void {
  const s = st();
  if (s.firstProbe) clearTimeout(s.firstProbe);
  if (s.timer) clearInterval(s.timer);
  s.firstProbe = null;
  s.timer = null;
}

function okFetch(): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
    })) as unknown as typeof globalThis.fetch;
}

function configured(): void {
  updateDiscordSettings({
    enabled: true,
    token: WEBHOOK,
    intervalMin: 10,
    heartbeat: true,
    alertOnDown: true,
    notifyPush: true,
    probeUrl: "https://exemple.test/api/health",
  });
}

/* ----------------------------------------------------- tick infaillible */

describe("runTick : jamais de rejection", () => {
  it("convertit une panne de base en résultat d'erreur au lieu de rejeter", async () => {
    configured();
    startMonitor({ fetchImpl: okFetch() });
    silenceTimers();

    // Simule SQLITE_BUSY sur les requêtes de stats (activité / sondes).
    const g = globalThis as unknown as { __repodropDb?: unknown };
    const realDb = g.__repodropDb;
    const real = realDb as { prepare: (sql: string) => unknown };
    g.__repodropDb = {
      prepare(sql: string) {
        if (/FROM events|FROM pings/.test(sql)) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
        return real.prepare(sql);
      },
    };

    let outcome: Awaited<ReturnType<typeof runTick>> | undefined;
    try {
      // Avant le correctif, cette promesse rejetteait → unhandled rejection
      // → process Node fermé (le moniteur… et le site avec).
      outcome = await runTick({ silent: false, force: true });
    } finally {
      g.__repodropDb = realDb;
    }

    expect(outcome).toBeDefined();
    expect(outcome!.sent).toBe(false);
    expect(outcome!.error).toContain("SQLITE_BUSY");
    expect(getMonitorStatus().lastError).toContain("SQLITE_BUSY");
  });
});

/* --------------------------------------------------- garde-fou anti-blocage */

describe("runTick : une sonde bloquée ne gèle pas le moniteur", () => {
  it("remplace la sonde orpheline et garde le bouton « Ping maintenant » opérationnel", async () => {
    configured();

    let releaseProbe!: (r: Response) => void;
    const hung = new Promise<Response>((r) => {
      releaseProbe = r;
    });
    const hungFetch = (() => hung) as unknown as typeof globalThis.fetch;

    startMonitor({ fetchImpl: hungFetch });
    silenceTimers();

    // Sonde n°1 : ne termine JAMAIS (fetch qui ignore AbortSignal…).
    const stuck = runTick({ silent: true });

    // On vieillit l'état pour déclencher le garde-fou (au-delà du délai
    // maximum légal d'une sonde), puis on repasse sur un fetch fonctionnel.
    st().inFlightSince = Date.now() - 60_000;
    st().deps = { fetchImpl: okFetch() };

    const out = await runTick({ silent: false, force: true });
    expect(out.probe.ok).toBe(true);
    expect(out.sent).toBe(true);
    expect(st().inFlight).toBe(false);

    // La sonde orpheline finit par répondre : elle ne doit pas casser l'état.
    releaseProbe(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await stuck;
    expect(st().inFlight).toBe(false);

    const again = await runTick({ silent: false, force: true });
    expect(again.sent).toBe(true);
  });

  it("refuse proprement un ping pendant qu'une sonde tourne encore", async () => {
    configured();

    let releaseProbe!: (r: Response) => void;
    const hung = new Promise<Response>((r) => {
      releaseProbe = r;
    });
    const hungFetch = (() => hung) as unknown as typeof globalThis.fetch;

    startMonitor({ fetchImpl: hungFetch });
    silenceTimers();

    const stuck = runTick({ silent: true });
    const out = await runTick({ silent: false, force: true });
    expect(out.sent).toBe(false);
    expect(out.probe.error).toContain("encore en cours");

    releaseProbe(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await stuck;
  });
});

/* --------------------------------------------------------- auto-réparation */

describe("ensureDiscordMonitor : auto-réparation", () => {
  it("relance le moniteur quand son timer a disparu", () => {
    configured();
    startMonitor({ fetchImpl: okFetch() });
    silenceTimers();
    expect(st().running).toBe(true);

    // Timer perdu (rechargement de module, échec…).
    silenceTimers();
    expect(st().running).toBe(true); // l'état dit « ça tourne »…

    expireHeal();
    ensureDiscordMonitor();

    expect(st().timer).not.toBeNull(); // …mais le timer est recréé
    expect(st().running).toBe(true);
  });

  it("démarre après une configuration différée (premier démarrage en échec)", () => {
    // Activé mais pas encore de jeton : le premier contrôle ne démarre rien.
    updateDiscordSettings({
      enabled: true,
      token: "",
      intervalMin: 10,
      probeUrl: "https://exemple.test/api/health",
    });
    expireHeal();
    ensureDiscordMonitor();
    expect(st().running).toBe(false);
    // Diagnostic lisible au lieu d'un silence total.
    expect(getMonitorStatus().lastError).toMatch(/SESSION_SECRET/);

    // Jeton configuré après coup — AUCUN arrêt explicite (process neuf).
    updateDiscordSettings({ token: WEBHOOK });
    st().manualStop = false;
    expireHeal();
    ensureDiscordMonitor();

    expect(st().running).toBe(true);
    expect(st().timer).not.toBeNull();
  });

  it("respecte l'arrêt explicite fait depuis le panel", () => {
    configured();
    startMonitor({ fetchImpl: okFetch() });
    silenceTimers();
    stopMonitor();
    expect(st().running).toBe(false);

    expireHeal();
    ensureDiscordMonitor();
    // Le bouton « Arrêter » ne doit pas être défaut par la réparation.
    expect(st().running).toBe(false);
    expect(st().timer).toBeNull();
  });

  it("signale un jeton devenu illisible (SESSION_SECRET changé)", () => {
    configured();
    startMonitor({ fetchImpl: okFetch() });
    silenceTimers();

    // Le chiffré en base ne s'ouvre plus avec la clé courante.
    setSettingRaw("discord.token", "enc:v1:AAAA:BBBB:CCCC");

    expireHeal();
    ensureDiscordMonitor();

    expect(getMonitorStatus().lastError).toMatch(/SESSION_SECRET/);
    // Les sondes continuent : seul l'envoi devient impossible, mais rien
    // n'est caché — le panel affiche l'erreur.
    expect(st().running).toBe(true);
  });
});

/* -------------------------------------------------------------- Gateway */

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

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  ops(op: number): { op: number; d?: unknown }[] {
    return this.sent.filter((m) => m.op === op);
  }
}

/** Socket « sourde » : close() ne déclenche jamais onclose. */
class DeafSocket extends FakeSocket {
  override close(): void {
    /* rien : la fermeture ne remonte aucun événement */
  }
}

describe("DiscordBot : la Gateway ne meurt plus silencieusement", () => {
  it("annule le premier battement (jitter) à l'arrêt", () => {
    vi.useFakeTimers();
    const bot = new DiscordBot("MTok.test", { socketCtor: FakeSocket });
    bot.connect();
    const sock = FakeSocket.instances.at(-1)!;

    sock.receive({ op: 10, d: { heartbeat_interval: 41_250 } });
    expect(vi.getTimerCount()).toBeGreaterThan(0); // jitter en attente

    bot.stop();
    expect(vi.getTimerCount()).toBe(0); // plus aucun timer fantôme

    const before = sock.sent.length;
    vi.advanceTimersByTime(120_000);
    expect(sock.sent.length).toBe(before); // aucun battement après stop()
  });

  it("reconnecte même si close() du socket ne remonte rien", () => {
    vi.useFakeTimers();
    const beforeCount = FakeSocket.instances.length;
    const bot = new DiscordBot("MTok.test", { socketCtor: DeafSocket });
    bot.connect();
    const sock = FakeSocket.instances.at(-1)!;

    sock.receive({ op: 10, d: { heartbeat_interval: 41_250 } });
    vi.advanceTimersByTime(5_000); // jitter écoulé → 1er battement (sans ACK)
    expect(sock.ops(1)).toHaveLength(1);

    vi.advanceTimersByTime(41_250); // battement suivant → détecteur zombie
    // close() ne fait rien : sans le filet de scheduleRetry, la Gateway
    // resterait morte pour toujours (bot « hors ligne » définitif).
    vi.advanceTimersByTime(1_000); // backoff initial (1 s)

    // +1 socket initial du bot, +1 socket de reconnexion (et `reconnects=1`).
    expect(FakeSocket.instances.length).toBe(beforeCount + 2);
    expect(bot.status.reconnects).toBe(1);
    bot.stop();
  });

  it("réinitialise la séquence d'ancienne session à chaque (re)connexion", () => {
    vi.useFakeTimers();
    const bot = new DiscordBot("MTok.test", { socketCtor: FakeSocket });
    bot.connect();
    const sock1 = FakeSocket.instances.at(-1)!;

    sock1.receive({ op: 10, d: { heartbeat_interval: 41_250 } });
    sock1.receive({ op: 0, t: "READY", s: 42, d: { user: { username: "b" } } });

    // Fermeture inattendue → reconnexion (nouvelle session, sans RESUME).
    sock1.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1_000);
    const sock2 = FakeSocket.instances.at(-1)!;
    expect(sock2).not.toBe(sock1);

    sock2.receive({ op: 10, d: { heartbeat_interval: 41_250 } });
    vi.advanceTimersByTime(5_000);
    const hb = sock2.ops(1).at(-1);
    expect(hb?.d).toBeNull(); // plus le seq 42 de la session morte
    bot.stop();
  });
});
