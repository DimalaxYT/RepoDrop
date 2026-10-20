/**
 * Rate-limit à fenêtre glissante.
 *
 * Le point important est le dernier groupe : les compteurs sont **persistés**,
 * donc un redémarrage du processus ne rend plus leurs essais aux clients.
 * C'était le défaut de la version en mémoire, et c'est exactement ce qu'un
 * attaquant exploite en relançant le service.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP = path.join(os.tmpdir(), `rd-ratelimit-${process.pid}`);
process.env.DB_PATH = path.join(TMP, "ratelimit.db");

import { clientIp, rateLimit, resetRateLimit } from "@/lib/ratelimit";
import { bucketGet, bucketPrune } from "@/lib/db";

beforeAll(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fenêtre glissante", () => {
  it("autorise jusqu'à la limite, puis refuse", () => {
    const key = "upload:203.0.113.1";
    resetRateLimit(key);

    for (let i = 0; i < 5; i += 1) {
      expect(rateLimit(key, 5, 60_000).ok).toBe(true);
    }
    const blocked = rateLimit(key, 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    resetRateLimit(key);
  });

  it("le délai annoncé ne dépasse jamais la fenêtre et n'est jamais nul", () => {
    const key = "upload:203.0.113.2";
    resetRateLimit(key);
    rateLimit(key, 1, 30_000);
    const res = rateLimit(key, 1, 30_000);
    expect(res.ok).toBe(false);
    expect(res.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(res.retryAfterSec).toBeLessThanOrEqual(30);
    resetRateLimit(key);
  });

  it("compte chaque clé séparément", () => {
    resetRateLimit("k:a");
    resetRateLimit("k:b");
    expect(rateLimit("k:a", 1, 60_000).ok).toBe(true);
    expect(rateLimit("k:a", 1, 60_000).ok).toBe(false);
    // L'autre clé n'est pas affectée.
    expect(rateLimit("k:b", 1, 60_000).ok).toBe(true);
    resetRateLimit("k:a");
    resetRateLimit("k:b");
  });

  it("libère la clé une fois la fenêtre écoulée", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const key = "upload:203.0.113.3";
    resetRateLimit(key);

    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(false);

    // Juste avant la fin de fenêtre : toujours bloqué.
    vi.advanceTimersByTime(59_000);
    expect(rateLimit(key, 2, 60_000).ok).toBe(false);

    // Fenêtre écoulée : les deux essais sont oubliés.
    vi.advanceTimersByTime(2_000);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    resetRateLimit(key);
  });

  it("fait glisser la fenêtre essai par essai, pas par bloc", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const key = "push:203.0.113.4";
    resetRateLimit(key);

    rateLimit(key, 2, 60_000); // t = 0
    vi.advanceTimersByTime(30_000);
    rateLimit(key, 2, 60_000); // t = 30 s
    expect(rateLimit(key, 2, 60_000).ok).toBe(false); // plein

    // À t = 61 s, seul le premier essai est sorti de la fenêtre.
    vi.advanceTimersByTime(31_000);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(false);
    resetRateLimit(key);
  });
});

describe("persistance", () => {
  it("survit à un rechargement complet du module", async () => {
    const key = "upload:198.51.100.9";
    resetRateLimit(key);

    const first = await import("@/lib/ratelimit");
    expect(first.rateLimit(key, 1, 60_000).ok).toBe(true);

    // Nouveau registre de modules = nouvelle instance, comme après un restart.
    vi.resetModules();
    const second = await import("@/lib/ratelimit");
    expect(second.rateLimit(key, 1, 60_000).ok).toBe(false);

    second.resetRateLimit(key);
  });

  it("écrit bien en base, pas seulement en mémoire", () => {
    const key = "upload:198.51.100.10";
    resetRateLimit(key);
    rateLimit(key, 5, 60_000);
    rateLimit(key, 5, 60_000);

    const raw = bucketGet(key);
    expect(raw).not.toBeNull();
    // Deux horodatages séparés par une virgule.
    expect((raw ?? "").split(",")).toHaveLength(2);
    resetRateLimit(key);
    expect(bucketGet(key)).toBeNull();
  });

  it("borne le volume stocké au nombre d'essais autorisés", () => {
    const key = "upload:198.51.100.11";
    resetRateLimit(key);
    for (let i = 0; i < 30; i += 1) rateLimit(key, 30, 60_000);
    expect((bucketGet(key) ?? "").split(",")).toHaveLength(30);
    resetRateLimit(key);
  });

  it("les lignes échues sont purgeables", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const key = "upload:198.51.100.12";
    resetRateLimit(key);
    rateLimit(key, 3, 1_000);

    vi.advanceTimersByTime(5_000);
    expect(bucketGet(key)).toBeNull(); // expirée à la lecture
    expect(bucketPrune()).toBeGreaterThanOrEqual(0);
    resetRateLimit(key);
  });
});

describe("clientIp", () => {
  it("prend la première adresse de x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientIp(h)).toBe("203.0.113.7");
  });

  it("retombe sur x-real-ip puis sur « local »", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("local");
  });

  it("x-forwarded-for a priorité sur x-real-ip", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.4" });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("nettoie les espaces autour de l'adresse", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "   203.0.113.11 , 1.2.3.4" }))).toBe(
      "203.0.113.11",
    );
  });
});
