/**
 * /api/staff/security — définit, change ou supprime le mot de passe du panel.
 *
 * Accessible uniquement depuis un panel déjà déverrouillé (`checkStaff`).
 * Le mot de passe actuel est exigé pour le changer, et le nouveau est stocké
 * sous forme d'empreinte scrypt salée — jamais en clair, jamais renvoyé.
 */
import { z } from "zod";
import { isSecureRequest, json, jsonError } from "@/lib/http";
import { setSessionCookie } from "@/lib/session";
import {
  checkStaff,
  setStaffPassword,
  staffPasswordUpdatedAt,
  verifyStaffPassword,
} from "@/lib/staff";
import { getString } from "@/lib/settings";
import { config } from "@/lib/config";
import { clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Mot de passe actuel, exigé dès qu'un mot de passe existe déjà. */
  current: z.string().max(200).optional(),
  /** Nouveau mot de passe. Chaîne vide = suppression du verrou. */
  password: z.string().max(200),
});

export async function GET(): Promise<Response> {
  const gate = await checkStaff();
  if (!gate.ok) return jsonError(gate.message, gate.status);

  const fromPanel = Boolean(getString("staff.passwordHash"));
  return json({
    passwordSet: fromPanel || Boolean(config.staffPassword),
    /** Le mot de passe vient du panel (modifiable) ou de STAFF_PASSWORD. */
    source: fromPanel ? "panel" : config.staffPassword ? "env" : "none",
    updatedAt: await staffPasswordUpdatedAt(),
  });
}

export async function POST(req: Request): Promise<Response> {
  const gate = await checkStaff();
  if (!gate.ok) return jsonError(gate.message, gate.status);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Corps JSON invalide.", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return jsonError("Requête invalide.", 400);

  const password = parsed.data.password;
  const current = parsed.data.current ?? "";

  // Changer (ou retirer) un mot de passe existant exige de connaître l'actuel.
  if (getString("staff.passwordHash")) {
    if (!(await verifyStaffPassword(current))) {
      return jsonError("Mot de passe actuel incorrect.", 403);
    }
  }

  if (password !== "" && password.length < 8) {
    return jsonError("Le mot de passe doit contenir au moins 8 caractères.", 400);
  }

  await setStaffPassword(password, {
    ip: clientIp(req.headers),
    login: gate.session.login,
  });

  // La session qui vient de définir le mot de passe reste déverrouillée :
  // on rescelle le cookie avec le claim, sinon le panel se refermerait sur
  // l'administrateur au moment même où il le configure.
  await setSessionCookie(
    { ...gate.session, staffUnlocked: true },
    isSecureRequest(req),
  );

  return json({
    ok: true,
    passwordSet: Boolean(password),
    updatedAt: await staffPasswordUpdatedAt(),
  });
}
