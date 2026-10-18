/** GET /api/repos — dépôts où l'utilisateur connecté a les droits de push. */
import { getSession } from "@/lib/session";
import { json, jsonError } from "@/lib/http";
import { listPushableRepos } from "@/lib/github";
import { toUserMessage, AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  try {
    const repos = await listPushableRepos(session.token);
    return json({ repos });
  } catch (e) {
    const status = e instanceof AppError && e.code === "RATE_LIMITED" ? 429 : 500;
    return jsonError(toUserMessage(e), status);
  }
}
