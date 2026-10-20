/**
 * GET /api/repos/[owner]/[repo]/tree?path=&ref=
 *
 * Liste un dossier du dépôt (racine si `path` est absent). Chargé à la demande,
 * dossier par dossier : on ne télécharge jamais l'arbre complet d'un dépôt.
 * Le chemin est validé par `safeRepoPath` (pas de `..`, pas de chemin absolu).
 */
import { getSession } from "@/lib/session";
import { json, jsonError } from "@/lib/http";
import { getTree, safeRef, safeRepoPath } from "@/lib/github";
import { toUserMessage, AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ owner: string; repo: string }>;
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { owner, repo } = await params;
  const url = new URL(req.url);

  let path = "";
  let ref = "";
  try {
    path = safeRepoPath(url.searchParams.get("path") ?? "");
    ref = safeRef(url.searchParams.get("ref"));
  } catch (e) {
    return jsonError(toUserMessage(e), 400);
  }

  try {
    const { entries, empty } = await getTree(session.token, owner, repo, path, ref);
    return json({ path, ref, entries, empty });
  } catch (e) {
    const status =
      e instanceof AppError && e.code === "NOT_FOUND"
        ? 404
        : e instanceof AppError && e.code === "RATE_LIMITED"
          ? 429
          : 500;
    return jsonError(toUserMessage(e), status);
  }
}
