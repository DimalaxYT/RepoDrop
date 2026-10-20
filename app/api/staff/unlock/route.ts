/**
 * /api/staff/unlock — déverrouille (ou reverrouille) le panel staff.
 *
 * Le mot de passe n'est jamais renvoyé ni stocké en clair : il est comparé à
 * une empreinte scrypt (`lib/staff.ts`), et la validation est portée par le
 * cookie de session chiffré (`staffUnlocked`). Elle disparaît donc à la
 * déconnexion et n'est jamais partagée entre comptes.
 *
 * Prérequis : être déjà connecté avec un compte de `STAFF_LOGINS`. Cette route
 * ne donne accès à rien d'autre qu'au claim `staffUnlocked`.
 */
import { z } from "zod";
import { isSecureRequest, json, jsonError } from "@/lib/http";
import { getSession, setSessionCookie } from "@/lib/session";
import {
  isStaffLogin,
  isStaffPasswordSet,
  recordUnlockFailure,
  resetUnlockAttempts,
  staffConfigured,
  unlockThrottledUntil,
  verifyStaffPassword,
} from "@/lib/staff";
import { logEvent } from "@/lib/db";
import { clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  password: z.string().max(200).optional(),
  action: z.enum(["unlock", "lock"]).optional(),
});

/** État du verrou — aucune donnée sensible, seulement des booléens. */
export async function GET(): Promise<Response> {
  const session = await getSession();
  return json({
    authenticated: Boolean(session),
    staff: isStaffLogin(session?.login),
    staffConfigured: staffConfigured(),
    passwordRequired: await isStaffPasswordSet(),
    unlocked: session?.staffUnlocked === true,
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);
  if (!isStaffLogin(session.login)) {
    return jsonError("Ce compte ne fait pas partie du staff.", 403);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Corps JSON invalide.", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError("Requête invalide.", 400);

  const password = parsed.data.password ?? "";
  const action = parsed.data.action ?? "unlock";
  const secure = isSecureRequest(req);
  const ip = clientIp(req.headers);

  // Verrouillage manuel : on retire le claim, le panel redemande le mot de passe.
  if (action === "lock") {
    await setSessionCookie({ ...session, staffUnlocked: false }, secure);
    logEvent({
      kind: "settings",
      login: session.login,
      ip,
      detail: { scope: "staff.unlock", action: "lock" },
    });
    return json({ ok: true, unlocked: false });
  }

  // Aucun mot de passe configuré : l'allowlist suffit, rien à saisir.
  if (!(await isStaffPasswordSet())) {
    await setSessionCookie({ ...session, staffUnlocked: true }, secure);
    return json({ ok: true, unlocked: true, passwordRequired: false });
  }

  // Anti brute force : 6 essais par IP sur 15 minutes.
  const until = unlockThrottledUntil(ip);
  if (until > 0) {
    const sec = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return jsonError(
      `Trop de tentatives. Réessayez dans ${Math.ceil(sec / 60)} min.`,
      429,
      { retryAfterSec: sec },
    );
  }

  if (!(await verifyStaffPassword(password))) {
    const left = recordUnlockFailure(ip);
    logEvent({
      kind: "settings",
      login: session.login,
      ip,
      detail: { scope: "staff.unlock", ok: false },
    });
    return jsonError(
      left > 0
        ? "Mot de passe incorrect."
        : "Trop de tentatives : patientez 15 minutes.",
      401,
      { attemptsLeft: left },
    );
  }

  resetUnlockAttempts(ip);
  await setSessionCookie({ ...session, staffUnlocked: true }, secure);
  logEvent({
    kind: "settings",
    login: session.login,
    ip,
    detail: { scope: "staff.unlock", ok: true },
  });
  return json({ ok: true, unlocked: true, passwordRequired: true });
}
