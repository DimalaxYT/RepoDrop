/**
 * Réglages applicatifs persistants (SQLite) — le point d'entrée unique du
 * panel staff pour configurer le bot Discord.
 *
 * Sécurité : les valeurs sensibles (`discord.token`) sont chiffrées en
 * AES-256-GCM avec une clé dérivée de `SESSION_SECRET` avant d'aller en base.
 * Jamais de jeton en clair sur le disque, jamais renvoyé au navigateur :
 * l'API ne retourne qu'une version masquée (`••••1a2b`) + un booléen
 * « configuré ».
 */
import crypto from "node:crypto";
import {
  deleteSettingRaw,
  getSettingRaw,
  setSettingRaw,
} from "./db";
import { config, sessionKey } from "./config";

const PREFIX = "enc:v1:";

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

function decrypt(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const data = Buffer.from(parts[2], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // SESSION_SECRET changé depuis l'écriture : la valeur est illisible.
    return null;
  }
}

/* ------------------------------------------------------------- primitives */

export function getSecret(key: string): string | null {
  const raw = getSettingRaw(key);
  if (!raw) return null;
  return decrypt(raw);
}

export function setSecret(key: string, value: string): void {
  setSettingRaw(key, encrypt(value));
}

export function clearSecret(key: string): void {
  deleteSettingRaw(key);
}

export function getString(key: string, def = ""): string {
  const raw = getSettingRaw(key);
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" ? parsed : def;
  } catch {
    return def;
  }
}

export function setString(key: string, value: string): void {
  setSettingRaw(key, JSON.stringify(value));
}

export function getBool(key: string, def: boolean): boolean {
  const raw = getSettingRaw(key);
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "boolean" ? parsed : def;
  } catch {
    return def;
  }
}

export function setBool(key: string, value: boolean): void {
  setSettingRaw(key, JSON.stringify(value));
}

export function getNumber(key: string, def: number): number {
  const raw = getSettingRaw(key);
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : def;
  } catch {
    return def;
  }
}

export function setNumber(key: string, value: number): void {
  setSettingRaw(key, JSON.stringify(value));
}

/* ------------------------------------------------------------- Discord */

export const DISCORD_KEYS = {
  enabled: "discord.enabled",
  token: "discord.token",
  channelId: "discord.channelId",
  intervalMin: "discord.intervalMin",
  heartbeat: "discord.heartbeat",
  notifyPush: "discord.notifyPush",
  alertOnDown: "discord.alertOnDown",
  probeUrl: "discord.probeUrl",
  roleMention: "discord.roleMention",
} as const;

export interface DiscordSettings {
  /** Le bot tourne-t-il ? */
  enabled: boolean;
  /** Jeton de bot (« Bot … ») OU URL de webhook. Vide = non configuré. */
  token: string;
  /** Canal cible (inutile en webhook : l'URL le porte déjà). */
  channelId: string;
  /** Période du ping, en minutes. */
  intervalMin: number;
  /** Poster un message d'état à chaque ping (sinon : silence tant que tout va). */
  heartbeat: boolean;
  /** Annoncer chaque push réussi/échoué. */
  notifyPush: boolean;
  /** Alerter quand le site ne répond plus. */
  alertOnDown: boolean;
  /** URL sondée (défaut : <APP_URL>/api/health). */
  probeUrl: string;
  /** Mention ajoutée au message (ex. `<@&1234>` ou `@here`). */
  roleMention: string;
}

export const DEFAULT_INTERVAL_MIN = 10;

/**
 * Réglages effectifs. La base (panel staff) a priorité ; à défaut on retombe
 * sur l'amorçage par variables d'environnement (pratique en Docker, où le
 * jeton est souvent déjà dans `.env`).
 */
export function getDiscordSettings(): DiscordSettings {
  return {
    enabled: getBool(DISCORD_KEYS.enabled, false),
    token: getSecret(DISCORD_KEYS.token) ?? config.discord.token.trim(),
    channelId: getString(DISCORD_KEYS.channelId) || config.discord.channelId.trim(),
    intervalMin: clampInterval(
      getNumber(DISCORD_KEYS.intervalMin, config.discord.intervalMin),
    ),
    heartbeat: getBool(DISCORD_KEYS.heartbeat, true),
    notifyPush: getBool(DISCORD_KEYS.notifyPush, true),
    alertOnDown: getBool(DISCORD_KEYS.alertOnDown, true),
    probeUrl: getString(DISCORD_KEYS.probeUrl),
    roleMention: getString(DISCORD_KEYS.roleMention),
  };
}

export function clampInterval(min: number): number {
  if (!Number.isFinite(min)) return DEFAULT_INTERVAL_MIN;
  return Math.min(1440, Math.max(1, Math.round(min)));
}

export interface DiscordSettingsPatch {
  enabled?: boolean;
  /** Jeton (ou URL de webhook). Chaîne vide = effacer. Absent = inchangé. */
  token?: string;
  channelId?: string;
  intervalMin?: number;
  heartbeat?: boolean;
  notifyPush?: boolean;
  alertOnDown?: boolean;
  probeUrl?: string;
  roleMention?: string;
}

/** Applique un patch partiel (le jeton n'est jamais renvoyé en clair). */
export function updateDiscordSettings(patch: DiscordSettingsPatch): DiscordSettings {
  if (patch.enabled !== undefined) setBool(DISCORD_KEYS.enabled, patch.enabled);
  if (patch.token !== undefined) {
    const t = patch.token.trim();
    if (t === "") clearSecret(DISCORD_KEYS.token);
    else setSecret(DISCORD_KEYS.token, t);
  }
  if (patch.channelId !== undefined) setString(DISCORD_KEYS.channelId, patch.channelId.trim());
  if (patch.intervalMin !== undefined) {
    setNumber(DISCORD_KEYS.intervalMin, clampInterval(patch.intervalMin));
  }
  if (patch.heartbeat !== undefined) setBool(DISCORD_KEYS.heartbeat, patch.heartbeat);
  if (patch.notifyPush !== undefined) setBool(DISCORD_KEYS.notifyPush, patch.notifyPush);
  if (patch.alertOnDown !== undefined) setBool(DISCORD_KEYS.alertOnDown, patch.alertOnDown);
  if (patch.probeUrl !== undefined) setString(DISCORD_KEYS.probeUrl, patch.probeUrl.trim());
  if (patch.roleMention !== undefined) {
    setString(DISCORD_KEYS.roleMention, patch.roleMention.trim().slice(0, 100));
  }
  return getDiscordSettings();
}

/* ------------------------------------------------------- helpers d'affichage */

const WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+/i;

/** Une URL de webhook peut remplacer un jeton de bot (aucune gateway). */
export function isWebhookUrl(value: string): boolean {
  return WEBHOOK_RE.test(value.trim());
}

/** Masque un jeton pour l'affichage : `mtok…••••1a2b` (4 derniers). */
export function maskSecret(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (isWebhookUrl(v)) {
    const tail = v.split("/").pop() ?? "";
    return `webhook …${tail.slice(-4)}`;
  }
  const head = v.slice(0, 4);
  const tail = v.slice(-4);
  return v.length <= 12 ? "••••••••" : `${head}…••••${tail}`;
}

/** Vue publique des réglages : tout sauf le secret, remplacé par son masque. */
export interface DiscordSettingsView extends Omit<DiscordSettings, "token"> {
  tokenSet: boolean;
  tokenMasked: string;
  tokenKind: "bot" | "webhook" | null;
}

export function discordSettingsView(
  s: DiscordSettings = getDiscordSettings(),
): DiscordSettingsView {
  const { token, ...rest } = s;
  return {
    ...rest,
    tokenSet: Boolean(token),
    tokenMasked: maskSecret(token),
    tokenKind: token ? (isWebhookUrl(token) ? "webhook" : "bot") : null,
  };
}
