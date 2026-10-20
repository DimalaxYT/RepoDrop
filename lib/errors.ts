/**
 * Erreurs métier traduites en messages utilisateur FR.
 * Les lib/ lancent des AppError avec un `code` ; jobs.ts les traduit.
 */

export type ErrorCode =
  | "ENCRYPTED"
  | "TOO_MANY_FILES"
  | "TOO_BIG"
  | "EMPTY"
  | "CORRUPT"
  | "UNSUPPORTED"
  | "VOLUME"
  | "UNSAFE_PATHS"
  | "PATH_LIMITS"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "REPO_EXISTS"
  | "NAME_INVALID"
  | "NO_CHANGES"
  | "CONFLICT"
  | "SCOPE_MISSING"
  | "GIT_FAILED"
  | "INTERRUPTED"
  | "BAD_PATH"
  | "CONFIRM_MISMATCH"
  | "INTERNAL";

export class AppError extends Error {
  code: ErrorCode;
  detail?: string;

  constructor(code: ErrorCode, message?: string, detail?: string) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
  }
}

const FR: Record<ErrorCode, string> = {
  ENCRYPTED:
    "Cette archive est protégée par un mot de passe, ce qui n'est pas supporté pour l'instant.",
  TOO_MANY_FILES: "Trop de fichiers dans l'archive (limite atteinte).",
  TOO_BIG:
    "Le contenu décompressé dépasse la taille autorisée. Réduisez l'archive (node_modules ?).",
  EMPTY: "Cette archive ne contient aucun fichier exploitable.",
  CORRUPT: "Archive illisible ou corrompue. Vérifiez le fichier puis réessayez.",
  UNSUPPORTED:
    "Format non pris en charge (méthode de compression ou variante d'archive inconnue).",
  VOLUME: "Les archives RAR multi-volumes (.part1.rar, .part2.rar…) ne sont pas supportées.",
  UNSAFE_PATHS:
    "L'archive contient des chemins de fichiers dangereux (traversal) et a été refusée.",
  PATH_LIMITS:
    "Un chemin de fichier dépasse les limites autorisées (profondeur ou longueur).",
  TIMEOUT: "L'extraction a pris trop de temps et a été interrompue.",
  RATE_LIMITED: "Trop de requêtes. Patientez un instant puis réessayez.",
  NOT_FOUND: "Ressource introuvable.",
  FORBIDDEN:
    "Vous n'avez pas les droits d'écriture sur ce dépôt (ou le jeton GitHub n'a pas le bon scope).",
  REPO_EXISTS: "Un dépôt porte déjà ce nom sur votre compte.",
  NAME_INVALID: "Nom de dépôt ou de branche invalide.",
  NO_CHANGES: "Rien à pousser : les fichiers correspondent déjà au dépôt destination.",
  CONFLICT:
    "Le dépôt destination a changé entre-temps. Réessayez (ou poussez sur une branche dédiée).",
  SCOPE_MISSING:
    "GitHub refuse la modification des fichiers de workflow (.github/workflows/…) : le jeton n'a pas le scope « workflow ». Déconnectez-vous puis reconnectez-vous pour l'accorder.",
  GIT_FAILED: "Le push vers GitHub a échoué.",
  INTERRUPTED: "Le traitement a été interrompu (redémarrage du serveur).",
  BAD_PATH: "Chemin de fichier invalide.",
  CONFIRM_MISMATCH:
    "La confirmation ne correspond pas au nom du dépôt : rien n'a été supprimé.",
  INTERNAL: "Erreur interne inattendue. Réessayez dans un instant.",
};

export function frMessage(code: ErrorCode): string {
  return FR[code] ?? FR.INTERNAL;
}

/** Traduit une erreur inconnue en message FR sûr (jamais de détail technique/token). */
export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) {
    const base = frMessage(err.code);
    if (err.detail) {
      // Détail fourni par la lib (ex : stderr git) — jamais de token ici,
      // l'auth se fait via GIT_ASKPASS (env), jamais via l'URL ou les args.
      const d = err.detail.replace(/\s+/g, " ").trim().slice(0, 300);
      if (d) return `${base} (${d})`;
    }
    return base;
  }
  return FR.INTERNAL;
}
