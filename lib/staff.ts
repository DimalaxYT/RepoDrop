/**
 * Contrôle d'accès au panel staff.
 *
 * Le staff est défini par `STAFF_LOGINS` (logins GitHub, séparés par des
 * virgules). Rien n'est deviné : si la liste est vide, personne n'entre —
 * sauf en mode développement (`DEV_AUTH=1`), où tout compte connecté passe,
 * pour ne pas bloquer un test local sans `.env` complet.
 */
import { config } from "./config";
import { getSession, type SessionData } from "./session";

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
  | { ok: false; status: 401 | 403; message: string };

/** Session + droits staff, pour les Route Handlers (401/403 explicites). */
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
  return { ok: true, session };
}

/** Version « page » : null si l'accès est refusé (→ redirection côté page). */
export async function getStaffSession(): Promise<SessionData | null> {
  const res = await checkStaff();
  return res.ok ? res.session : null;
}
