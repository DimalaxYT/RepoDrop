/**
 * Réglages chiffrés + journal d'activité + sondes : la couche base du panel
 * staff. Aucune valeur sensible ne doit se retrouver en clair dans SQLite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP = path.join(os.tmpdir(), `rd-settings-${process.pid}`);
process.env.DB_PATH = path.join(TMP, "settings.db");
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

import {
  activityStats,
  countEvents,
  getSettingRaw,
  listEvents,
  listEventLogins,
  listPings,
  logEvent,
  pingStats,
  recordPing,
} from "@/lib/db";
import {
  clampInterval,
  discordSettingsView,
  getBool,
  getDiscordSettings,
  getSecret,
  maskSecret,
  isWebhookUrl,
  setSecret,
  updateDiscordSettings,
} from "@/lib/settings";

beforeAll(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});

afterAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
});

describe("chiffrement des secrets", () => {
  it("stocke le jeton chiffré et le restitue intact", () => {
    setSecret("test.secret", "MTok.vrai.jeton.discord");

    const raw = getSettingRaw("test.secret") ?? "";
    expect(raw.startsWith("enc:v1:")).toBe(true);
    expect(raw).not.toContain("MTok.vrai.jeton.discord");
    expect(getSecret("test.secret")).toBe("MTok.vrai.jeton.discord");
  });

  it("ne laisse jamais le jeton en clair dans le fichier SQLite", () => {
    setSecret("test.secret2", "SUPER-SECRET-123456");
    const content = fs.readFileSync(process.env.DB_PATH!, "latin1");
    expect(content).not.toContain("SUPER-SECRET-123456");
  });

  it("renvoie null pour une clé absente", () => {
    expect(getSecret("test.inexistant")).toBeNull();
  });
});

describe("masquage et type de secret", () => {
  it("masque un jeton de bot", () => {
    expect(maskSecret("MTok.abcdefg.1234567890")).toBe("MTok…••••7890");
    expect(maskSecret("court")).toBe("••••••••");
    expect(maskSecret("")).toBe("");
  });

  it("reconnaît une URL de webhook", () => {
    expect(isWebhookUrl("https://discord.com/api/webhooks/1234/abcd_efgh")).toBe(true);
    expect(isWebhookUrl("https://discordapp.com/api/webhooks/1/a")).toBe(true);
    expect(isWebhookUrl("MTok.pas.un.webhook")).toBe(false);
  });
});

describe("réglages Discord", () => {
  it("applique un patch partiel sans écraser le jeton", () => {
    updateDiscordSettings({ token: "MTok.premier", channelId: "111", intervalMin: 10 });
    updateDiscordSettings({ intervalMin: 15, heartbeat: false });

    const s = getDiscordSettings();
    expect(s.token).toBe("MTok.premier");
    expect(s.channelId).toBe("111");
    expect(s.intervalMin).toBe(15);
    expect(s.heartbeat).toBe(false);
  });

  it("borde la période entre 1 et 1440 minutes", () => {
    expect(clampInterval(0)).toBe(1);
    expect(clampInterval(-5)).toBe(1);
    expect(clampInterval(9999)).toBe(1440);
    expect(clampInterval(10.4)).toBe(10);
    expect(clampInterval(Number.NaN)).toBe(10);
  });

  it("supprime le jeton quand on envoie une chaîne vide", () => {
    updateDiscordSettings({ token: "" });
    expect(getDiscordSettings().token).toBe("");
  });

  it("expose une vue publique sans le secret", () => {
    updateDiscordSettings({ token: "MTok.abcdefg.9999", channelId: "42" });
    const view = discordSettingsView();
    expect("token" in view).toBe(false);
    expect(view.tokenSet).toBe(true);
    expect(view.tokenMasked).toBe("MTok…••••9999");
    expect(view.tokenKind).toBe("bot");
    expect(JSON.stringify(view)).not.toContain("MTok.abcdefg.9999");
  });

  it("lit les booléens avec leur valeur par défaut", () => {
    expect(getBool("discord.alertOnDown", true)).toBe(true);
  });
});

describe("journal d'activité", () => {
  it("trace un push et le retrouve par utilisateur", () => {
    logEvent({
      kind: "push",
      login: "alice",
      detail: { ok: true, repo: "alice/projet", branch: "main", sha: "abc1234", files: 4 },
    });
    logEvent({
      kind: "push",
      login: "bob",
      detail: { ok: false, error: "conflit" },
    });
    logEvent({ kind: "upload", login: "alice", detail: { filename: "x.tar" } });

    const all = listEvents({});
    expect(all.length).toBeGreaterThanOrEqual(3);

    const alice = listEvents({ login: "alice" });
    expect(alice.every((e) => e.login === "alice")).toBe(true);

    const pushes = listEvents({ kind: "push" });
    expect(pushes.every((e) => e.kind === "push")).toBe(true);

    const search = listEvents({ q: "alice/projet" });
    expect(search.length).toBe(1);
    expect(search[0].login).toBe("alice");
  });

  it("compte les événements et liste les contributeurs", () => {
    expect(countEvents({ kind: "push" })).toBeGreaterThanOrEqual(2);
    const logins = listEventLogins(10);
    expect(logins.map((l) => l.login)).toEqual(expect.arrayContaining(["alice", "bob"]));
  });

  it("distingue les push réussis des échecs dans les statistiques", () => {
    const stats = activityStats();
    expect(stats.totalPushes).toBeGreaterThanOrEqual(2);
    expect(stats.failedPushes).toBeGreaterThanOrEqual(1);
    expect(stats.users24h).toBeGreaterThanOrEqual(2);
  });

  it("pagine", () => {
    const first = listEvents({ limit: 1, offset: 0 });
    const second = listEvents({ limit: 1, offset: 1 });
    expect(first[0].id).not.toBe(second[0].id);
  });
});

describe("sondes de disponibilité", () => {
  it("enregistre et agrège les pings", () => {
    recordPing({ ok: true, latencyMs: 40, status: 200 });
    recordPing({ ok: true, latencyMs: 60, status: 200 });
    recordPing({ ok: false, latencyMs: null, status: null, error: "timeout" });

    const rows = listPings(10);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0].createdAt).toBeGreaterThanOrEqual(rows[1].createdAt);

    const stats = pingStats(24 * 3_600_000);
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.ok).toBeGreaterThanOrEqual(2);
    expect(stats.uptimePct).not.toBeNull();
    expect(stats.avgLatencyMs).toBe(50);
  });
});
