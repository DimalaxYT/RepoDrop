/**
 * Sessions : cookie chiffré (JWE A256GCM via jose).
 * Le token GitHub n'est stocké QUE dans le cookie chiffré — jamais en base,
 * jamais en log, jamais en clair côté client.
 */
import { cookies } from "next/headers";
import { CompactEncrypt, compactDecrypt } from "jose";
import { config, sessionKey } from "./config";

export const SESSION_COOKIE = "rd_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 jours

export interface SessionData {
  login: string;
  name: string;
  avatar: string;
  token: string;
  /**
   * Mot de passe du panel staff validé pour cette session. Porté par le cookie
   * chiffré : il disparaît donc à la déconnexion et ne touche jamais la base.
   */
  staffUnlocked?: boolean;
}

function key(): Uint8Array {
  return new Uint8Array(sessionKey());
}

export async function sealSession(data: SessionData): Promise<string> {
  const payload = JSON.stringify({ ...data, exp: Date.now() + MAX_AGE * 1000 });
  return new CompactEncrypt(new TextEncoder().encode(payload))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(key());
}

export async function openSession(sealed: string): Promise<SessionData | null> {
  try {
    const { plaintext } = await compactDecrypt(sealed, key());
    const data = JSON.parse(new TextDecoder().decode(plaintext)) as SessionData & {
      exp: number;
    };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (!data.login || !data.token) return null;
    return {
      login: data.login,
      name: data.name ?? data.login,
      avatar: data.avatar ?? "",
      token: data.token,
      staffUnlocked: data.staffUnlocked === true,
    };
  } catch {
    return null;
  }
}

/** Lecture de la session dans un Server Component / Route Handler. */
export async function getSession(): Promise<SessionData | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return openSession(raw);
}

/**
 * Écriture du cookie (Route Handler OAuth).
 * `secure` devrait refléter le protocole réel de la requête (cf. isSecureRequest)
 * : un cookie `Secure` posé sur une origine http:// est refusé par le navigateur.
 */
export async function setSessionCookie(
  data: SessionData,
  secure = config.appUrl.startsWith("https"),
): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sealSession(data), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
