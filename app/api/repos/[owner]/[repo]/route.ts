/**
 * /api/repos/[owner]/[repo] — détails et actions rapides sur un dépôt.
 *
 *   GET    → informations (droits inclus), pour l'en-tête du navigateur
 *   PATCH  → renommer, changer la visibilité, éditer la description
 *   DELETE → supprimer (confirmation `owner/repo` exigée dans le corps)
 *
 * Les deux actions destructrices sont journalisées dans le flux d'activité du
 * panel staff : qui a supprimé ou renommé quoi, et quand.
 */
import { z } from "zod";
import { getSession } from "@/lib/session";
import { json, jsonError } from "@/lib/http";
import { clientIp } from "@/lib/ratelimit";
import { deleteRepo, getRepoInfo, updateRepo } from "@/lib/github";
import { logEvent } from "@/lib/db";
import { toUserMessage, AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ owner: string; repo: string }>;
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    private: z.boolean().optional(),
    description: z.string().max(350).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Aucune modification." });

const deleteSchema = z.object({
  /** Doit reproduire exactement `owner/repo`. */
  confirm: z.string().max(200),
});

/** Statut HTTP adapté à l'erreur GitHub traduite. */
function statusOf(e: unknown): number {
  if (!(e instanceof AppError)) return 500;
  if (e.code === "RATE_LIMITED") return 429;
  if (e.code === "NOT_FOUND") return 404;
  if (e.code === "FORBIDDEN") return 403;
  if (e.code === "REPO_EXISTS" || e.code === "CONFLICT") return 409;
  if (e.code === "CONFIRM_MISMATCH") return 409;
  if (e.code === "NAME_INVALID" || e.code === "BAD_PATH") return 400;
  return 500;
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { owner, repo } = await params;
  try {
    return json({ repo: await getRepoInfo(session.token, owner, repo) });
  } catch (e) {
    return jsonError(toUserMessage(e), statusOf(e));
  }
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { owner, repo } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Corps JSON invalide.", 400);
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues.map((i) => i.message).join(" ") || "Modification invalide.",
      400,
    );
  }

  try {
    const updated = await updateRepo(session.token, owner, repo, parsed.data);
    const changed = Object.keys(parsed.data);
    logEvent({
      kind: "system",
      login: session.login,
      ip: clientIp(req.headers),
      detail: {
        scope: "repo.update",
        repo: updated.full_name,
        was: `${owner}/${repo}`,
        changed,
        private: updated.private,
      },
    });
    return json({ repo: updated });
  } catch (e) {
    return jsonError(toUserMessage(e), statusOf(e));
  }
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { owner, repo } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Corps JSON invalide.", 400);
  }
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) return jsonError("Confirmation manquante.", 400);

  try {
    await deleteRepo(session.token, owner, repo, parsed.data.confirm);
  } catch (e) {
    // Échec de confirmation ou refus GitHub : on journalise la tentative,
    // sans jamais y faire figurer le jeton.
    if (e instanceof AppError && e.code === "CONFIRM_MISMATCH") {
      // Confirmation erronée : aucun appel GitHub n'a été fait, donc rien à
      // journaliser côté « tentative de suppression ».
      return jsonError(toUserMessage(e), 409);
    }
    logEvent({
      kind: "system",
      login: session.login,
      ip: clientIp(req.headers),
      detail: { scope: "repo.delete", repo: `${owner}/${repo}`, ok: false },
    });
    return jsonError(toUserMessage(e), statusOf(e));
  }

  logEvent({
    kind: "system",
    login: session.login,
    ip: clientIp(req.headers),
    detail: { scope: "repo.delete", repo: `${owner}/${repo}`, ok: true },
  });
  return json({ ok: true, deleted: `${owner}/${repo}` });
}
