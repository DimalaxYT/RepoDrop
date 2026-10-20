/**
 * Contrôle d'accès au panel staff.
 *
 * Deux verrous cumulatifs :
 *   1. `STAFF_LOGINS` (logins GitHub, séparés par des virgules). Rien n'est
 *      deviné : si la liste est vide, personne n'entre — sauf en mode
 *      développement (`DEV_AUTH=1`), où tout compte connecté passe ;
 *   2. un **mot de passe** de panel, défini depuis le panel lui-même (empreinte
 *      scrypt en base) ou amorcé par `STAFF_PASSWORD`. Validé une fois, il est
 *      porté par le cookie de session chiffré jusqu'à la déconnexion.
 */
import crypto from "node:crypto";
import { config } from "./config";
import { getSession, type SessionData } from "./session";
import { getString, setString } from "./settings";
import { logEvent } from "./db";

/** La liste `STAFF_LOGINS` est-elle renseignée ? */
export function staffConfigured(): boolean {
  return config.staffLogins.length > 0;
}

/** Vérification du login (insensible à la casse, comme GitHub). */
export function isStaffLogin(login: string | null | undefined): boolean {
  if (!login) return false;
  const normalized = login.trim().toLowerCase();
  if (!normalized) return false;
  if (config.staffLogins.includes(normalized)) return true;
  // Dev uniquement : aucun compte déclaré → tout le monde est staff.
  return config.devAuth && config.staffLogins.length === 0;
}

export type StaffCheck =
  | { ok: true; session: SessionData }
  | {
      ok: false;
      status: 401 | 403;
      message: string;
      /** true quand seul le mot de passe manque (compte staff reconnu). */
      locked?: boolean;
    };

/**
 * Session + droits staff, pour les Route Handlers (401/403 explicites).
 * C'est LE point de contrôle : le panel et toutes les API `/api/staff/*`
 * passent par ici, mot de passe compris.
 */
export async function checkStaff(): Promise<StaffCheck> {
  const session = await getSession();
  if (!session) {
    return { ok: false, status: 401, message: "Authentification requise." };
  }
  if (!isStaffLogin(session.login)) {
    return {
      ok: false,
      status: 403,
      message: staffConfigured()
        ? "Ce compte ne fait pas partie du staff."
        : "Aucun compte staff configuré : renseignez STAFF_LOGINS dans .env.",
    };
  }
  if ((await isStaffPasswordSet()) && session.staffUnlocked !== true) {
    return {
      ok: false,
      status: 403,
      message: "Mot de passe du panel requis.",
      locked: true,
    };
  }
  return { ok: true, session };
}

/**
 * État d'accès du visiteur, pour choisir l'écran à afficher :
 * `denied` (pas staff), `locked` (staff, mot de passe à saisir), `granted`.
 */
export async function staffAccess(): Promise<"denied" | "locked" | "granted"> {
  const gate = await checkStaff();
  if (gate.ok) return "granted";
  return gate.locked ? "locked" : "denied";
}

/** Version « page » : null si l'accès est refusé (→ redirection côté page). */
export async function getStaffSession(): Promise<SessionData | null> {
  const res = await checkStaff();
  return res.ok ? res.session : null;
}

/* ------------------------------------------------------------------ *
 * Mot de passe du panel
 * ------------------------------------------------------------------ */

const PASSWORD_KEY = "staff.passwordHash";
const PASSWORD_AT_KEY = "staff.passwordUpdatedAt";

/** Paramètres scrypt (N=16384 ≈ 16 Mo de mémoire, r=8, p=1). */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

/** Dérive un mot de passe en empreinte scrypt salée, auto-descriptive. */
export function hashStaffPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  const params = `N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}`;
  return `scrypt$${params}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Vérifie un mot de passe contre une empreinte `scrypt$…`, en temps constant.
 * Toute empreinte illisible est un échec (jamais une exception).
 */
export function verifyStaffPasswordHash(
  password: string,
  stored: string,
): boolean {
  if (typeof password !== "string" || password.length === 0) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const params: Record<string, number> = {};
  for (const kv of parts[1].split(",")) {
    const [k, v] = kv.split("=");
    const n = parseInt(v ?? "", 10);
    if (!k || !Number.isFinite(n) || n <= 0) return false;
    params[k] = n;
  }
  if (!params.N || !params.r || !params.p) return false;
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, {
      N: params.N,
      r: params.r,
      p: params.p,
    });
  } catch {
    return false;
  }
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

/** Un mot de passe est-il exigé pour entrer dans le panel ? */
export async function isStaffPasswordSet(): Promise<boolean> {
  if (getString(PASSWORD_KEY)) return true;
  return config.staffPassword.length > 0;
}

/**
 * Vérifie le mot de passe saisi. L'empreinte enregistrée depuis le panel a
 * priorité ; `STAFF_PASSWORD` ne sert que d'amorçage.
 */
export async function verifyStaffPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const stored = getString(PASSWORD_KEY);
  if (stored) return verifyStaffPasswordHash(password, stored);
  if (config.staffPassword) {
    const a = Buffer.from(password);
    const b = Buffer.from(config.staffPassword);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

/** Enregistre le mot de passe du panel (chaîne vide = suppression). */
export async function setStaffPassword(
  password: string,
  meta: { ip?: string; login?: string } = {},
): Promise<void> {
  if (password) {
    setString(PASSWORD_KEY, hashStaffPassword(password));
    setString(PASSWORD_AT_KEY, new Date().toISOString());
  } else {
    setString(PASSWORD_KEY, "");
    setString(PASSWORD_AT_KEY, "");
  }
  logEvent({
    kind: "settings",
    login: meta.login,
    ip: meta.ip,
    detail: { scope: "staff.password", enabled: Boolean(password) },
  });
}

/** Date (ISO) du dernier changement de mot de passe, si connue. */
export async function staffPasswordUpdatedAt(): Promise<string | null> {
  return getString(PASSWORD_AT_KEY) || null;
}

/* --- Limitation des tentatives de déverrouillage (anti brute force) --- */

const MAX_ATTEMPTS = 6;
const WINDOW_MS = 15 * 60 * 1000;

type AttemptEntry = { count: number; windowStart: number; blockedUntil: number };
const attempts = new Map<string, AttemptEntry>();

/**
 * Timestamp jusqu'auquel cette IP est bloquée (0 = libre).
 * Les échecs ne bloquent qu'à partir du seuil : une simple faute de frappe ne
 * doit pas fermer le panel.
 */
export function unlockThrottledUntil(ip: string): number {
  const entry = attempts.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.blockedUntil > now) return entry.blockedUntil;
  // Fenêtre de comptage écoulée : on repart de zéro.
  if (now - entry.windowStart > WINDOW_MS) attempts.delete(ip);
  return 0;
}

/**
 * Comptabilise un échec ; renvoie le nombre de tentatives encore autorisées
 * (0 = seuil atteint, l'IP est bloquée pour `WINDOW_MS`).
 */
export function recordUnlockFailure(ip: string): number {
  const now = Date.now();
  let entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS || entry.blockedUntil > now) {
    entry = { count: 0, windowStart: now, blockedUntil: 0 };
    attempts.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + WINDOW_MS;
    return 0;
  }
  return MAX_ATTEMPTS - entry.count;
}

export function resetUnlockAttempts(ip: string): void {
  attempts.delete(ip);
}
