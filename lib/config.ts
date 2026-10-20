/**
 * Configuration centralisée : toutes les limites et clés passent par là.
 * Les secrets ne sont JAMAIS écrits en base ni loggés.
 */
import crypto from "node:crypto";

const int = (v: string | undefined, def: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
};

export const config = {
  /** URL publique de l'app (callback OAuth) */
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    /**
     * Base de l'API REST. Surchargeable (GITHUB_API_URL) pour pointer vers un
     * serveur de test : c'est ce qui permet de vérifier les routes sans jeton.
     */
    apiUrl: (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(
      /\/+$/,
      "",
    ),
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },
  /** Mode dev : bouton de connexion directe (jamais en prod) */
  devAuth: process.env.DEV_AUTH === "1",
  /**
   * Comptes GitHub autorisés sur le panel staff (`STAFF_LOGINS=a,b`).
   * Vide + DEV_AUTH=1 : n'importe quel compte connecté (pratique en dev).
   */
  staffLogins: (process.env.STAFF_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /**
   * Mot de passe du panel staff, amorçable par variable d'environnement.
   * Le panel peut en définir un lui-même : la valeur en base a priorité.
   */
  staffPassword: process.env.STAFF_PASSWORD ?? "",
  /**
   * Amorçage du bot Discord par variables d'environnement (Docker).
   * Le panel staff a TOUJOURS priorité : ce qui est en base gagne.
   */
  discord: {
    token:
      process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_WEBHOOK_URL ?? "",
    channelId: process.env.DISCORD_CHANNEL_ID ?? "",
    intervalMin: int(process.env.DISCORD_PING_MINUTES, 10),
  },
  /** Cookie de session chiffré (>= 32 octets) */
  sessionSecret: process.env.SESSION_SECRET ?? "", //résolu paresseusement
  limits: {
    /** Poids max de l'archive uploadée */
    maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 200) * 1024 * 1024,
    /** Poids max une fois décompressée */
    maxExtractBytes: int(process.env.MAX_EXTRACT_MB, 500) * 1024 * 1024,
    /** Nombre max de fichiers dans l'archive */
    maxFiles: int(process.env.MAX_FILES, 20_000),
    /** Ratio compression au-delà duquel on considère qu'il s'agit d'une bombe */
    maxCompressionRatio: int(process.env.MAX_RATIO, 200),
    /** Profondeur max d'arborescence */
    maxDepth: int(process.env.MAX_DEPTH, 64),
    /** Longueur max d'un chemin relatif */
    maxPathLength: 1000,
    /** Rate-limit : poussées par heure et par utilisateur */
    pushesPerHour: int(process.env.PUSHES_PER_HOUR, 10),
    /** Rate-limit : uploads par heure et par IP */
    uploadsPerHour: int(process.env.UPLOADS_PER_HOUR, 30),
  },
  /** Dossier de travail des jobs (extractions éphémères) */
  jobsDir: process.env.JOBS_DIR ?? "/tmp/repodrop-jobs",
  /** Fichier SQLite (créé au premier usage) */
  dbPath: process.env.DB_PATH ?? `${process.cwd()}/data/repodrop.db`,
};

/** Clé de session stable : SESSION_SECRET en prod, sinon aléatoire (sessions perdues au restart en dev). */
let cachedKey: Buffer | null = null;
export function sessionKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (config.sessionSecret) {
    // Dérive une clé AES-256-GCM propre depuis le secret fourni.
    cachedKey = crypto.createHash("sha256").update(config.sessionSecret).digest();
    return cachedKey;
  }
  cachedKey = crypto.randomBytes(32);
  return cachedKey;
}
