/**
 * Construction des messages Discord (embeds).
 *
 * Fichier 100 % pur : aucune dépendance réseau ni base — tout est testable.
 * Les couleurs reprennent la palette du site (vert = OK, rouge = HS,
 * bleu = info) pour que le canal Discord reste lisible d'un coup d'œil.
 */

export const COLORS = {
  ok: 0x34d399,
  down: 0xf87171,
  info: 0x38bdf8,
  warn: 0xfbbf24,
} as const;

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
  url?: string;
}

export interface DiscordPayload {
  content?: string;
  embeds: Embed[];
  /** Réservé aux webhooks. */
  username?: string;
  avatar_url?: string;
}

export interface SiteProbe {
  url: string;
  ok: boolean;
  latencyMs: number | null;
  status: number | null;
  error: string | null;
  checkedAt: number;
}

export interface HeartbeatContext {
  probe: SiteProbe;
  intervalMin: number;
  uptimePct: number | null;
  avgLatencyMs: number | null;
  pushes24h: number;
  /** true = le site vient de revenir après une panne. */
  recovered?: boolean;
}

function latencyLabel(ms: number | null): string {
  return ms === null ? "—" : `${Math.round(ms)} ms`;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("fr-FR")} %`;
}

/**
 * Message périodique : « le site répond, voilà l'état ».
 * Un seul et même gabarit pour OK / HS / retour après panne.
 */
export function buildHeartbeatPayload(
  ctx: HeartbeatContext,
  mention = "",
): DiscordPayload {
  const { probe } = ctx;
  const down = !probe.ok;

  const embed: Embed = {
    title: down
      ? "🔴 RepoDrop ne répond plus"
      : ctx.recovered
        ? "🟢 RepoDrop est de retour"
        : "🏓 Ping RepoDrop — site en ligne",
    color: down ? COLORS.down : COLORS.ok,
    fields: [
      { name: "Réponse", value: down ? `HS (${probe.error ?? "injoignable"})` : "OK", inline: true },
      { name: "Latence", value: latencyLabel(probe.latencyMs), inline: true },
      { name: "HTTP", value: probe.status ? String(probe.status) : "—", inline: true },
      {
        name: "Disponibilité 24 h",
        value: pct(ctx.uptimePct),
        inline: true,
      },
      { name: "Latence moyenne 24 h", value: latencyLabel(ctx.avgLatencyMs), inline: true },
      { name: "Push 24 h", value: String(ctx.pushes24h), inline: true },
      { name: "URL sondée", value: probe.url, inline: false },
    ],
    footer: {
      text: `Sonde automatique toutes les ${ctx.intervalMin} min · RepoDrop`,
    },
    timestamp: new Date(probe.checkedAt).toISOString(),
  };

  return {
    // Une mention explicite uniquement quand ça casse (ou au retour).
    content: down || ctx.recovered ? mention || undefined : undefined,
    embeds: [embed],
  };
}

export interface PushEventInfo {
  login: string;
  ok: boolean;
  repo?: string;
  branch?: string;
  sha?: string;
  files?: number;
  bytes?: number;
  /** Nom de l'archive importée (.rar/.zip/.tar…). */
  filename?: string;
  error?: string | null;
  at: number;
}

function formatBytesFr(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${units[i]}`;
}

/** Annonce d'un push (réussi ou échoué) : qui, où, quand. */
export function buildPushPayload(e: PushEventInfo): DiscordPayload {
  const when = new Date(e.at).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
  const embed: Embed = {
    title: e.ok ? "📦 Code poussé sur GitHub" : "⚠️ Push en échec",
    description: e.ok
      ? `**${e.login}** a poussé du code via RepoDrop.`
      : `**${e.login}** a tenté un push qui a échoué.`,
    color: e.ok ? COLORS.ok : COLORS.warn,
    fields: [
      { name: "Utilisateur", value: e.login, inline: true },
      { name: "Dépôt", value: e.repo ?? "—", inline: true },
      { name: "Branche", value: e.branch ?? "—", inline: true },
      { name: "Commit", value: e.sha ? `\`${e.sha.slice(0, 7)}\`` : "—", inline: true },
      { name: "Fichiers", value: e.files !== undefined ? String(e.files) : "—", inline: true },
      { name: "Volume", value: formatBytesFr(e.bytes), inline: true },
      { name: "Archive", value: e.filename ?? "—", inline: false },
      { name: "Quand", value: when, inline: false },
    ],
    footer: { text: "RepoDrop · journal des push" },
    timestamp: new Date(e.at).toISOString(),
  };
  if (!e.ok && e.error) {
    embed.fields?.push({ name: "Erreur", value: e.error.slice(0, 400), inline: false });
  }
  if (e.ok && e.repo) {
    embed.url = `https://github.com/${e.repo}${e.branch ? `/tree/${e.branch}` : ""}`;
  }
  return { embeds: [embed] };
}

/** Message de test envoyé depuis le panel staff. */
export function buildTestPayload(who: string): DiscordPayload {
  return {
    embeds: [
      {
        title: "✅ Bot RepoDrop connecté",
        description:
          "Le canal est correctement configuré : les pings périodiques et les annonces de push arriveront ici.",
        color: COLORS.info,
        fields: [{ name: "Configuré par", value: who, inline: true }],
        footer: { text: "RepoDrop · panel staff" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
