/**
 * /api/staff/settings — lecture et écriture des réglages du bot Discord.
 *
 * Le jeton est **write-only** : le GET renvoie `tokenSet` + `tokenMasked`,
 * jamais la valeur. L'écriture le chiffre (AES-256-GCM, clé dérivée de
 * `SESSION_SECRET`) avant la base SQLite, puis redémarre le moniteur pour que
 * la nouvelle configuration prenne effet immédiatement.
 */
import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { checkStaff, staffConfigured } from "@/lib/staff";
import { logEvent } from "@/lib/db";
import {
  DISCORD_KEYS,
  discordSettingsView,
  getDiscordSettings,
  updateDiscordSettings,
} from "@/lib/settings";
import { getMonitorStatus, restartMonitor } from "@/lib/discord/monitor";
import { clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** Jeton de bot ou URL de webhook. Chaîne vide = effacer. */
    token: z.string().trim().max(2000).optional(),
    channelId: z
      .string()
      .trim()
      .regex(/^\d{0,25}$/, "L'identifiant de canal est une suite de chiffres.")
      .optional(),
    intervalMin: z.number().int().min(1).max(1440).optional(),
    heartbeat: z.boolean().optional(),
    notifyPush: z.boolean().optional(),
    alertOnDown: z.boolean().optional(),
    probeUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => {
        if (v === "") return true;
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      }, "URL de sonde invalide (http/https attendu).")
      .optional(),
    roleMention: z.string().trim().max(100).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Aucun réglage fourni." });

export async function GET(): Promise<Response> {
  const gate = await checkStaff();
  if (!gate.ok) return jsonError(gate.message, gate.status);

  return json({
    settings: discordSettingsView(getDiscordSettings()),
    status: getMonitorStatus(),
    staffConfigured: staffConfigured(),
    /** Sans SESSION_SECRET, le chiffrement du jeton ne survit pas au restart. */
    persistentSecrets: Boolean(process.env.SESSION_SECRET),
  });
}

export async function PUT(req: Request): Promise<Response> {
  const gate = await checkStaff();
  if (!gate.ok) return jsonError(gate.message, gate.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Corps JSON invalide.", 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues.map((i) => i.message).join(" ") || "Réglages invalides.",
      400,
    );
  }

  const patch = parsed.data;
  const before = getDiscordSettings();
  const next = updateDiscordSettings(patch);
  restartMonitor();

  // Traçabilité SANS valeur : on note uniquement quelles clés ont bougé
  // (le nom d'une clé n'est pas sensible ; sa valeur ne sort jamais d'ici).
  const changed = Object.keys(patch);
  logEvent({
    kind: "settings",
    login: gate.session.login,
    ip: clientIp(req.headers),
    detail: {
      scope: "discord",
      changed,
      enabled: next.enabled,
      intervalMin: next.intervalMin,
      mode: next.token ? "configuré" : "vide",
      wasEnabled: before.enabled,
    },
  });

  return json({
    settings: discordSettingsView(next),
    status: getMonitorStatus(),
    key: DISCORD_KEYS.token,
  });
}
