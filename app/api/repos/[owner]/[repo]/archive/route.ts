/**
 * GET /api/repos/[owner]/[repo]/archive?format=zip|tar.gz&ref=
 *
 * Télécharge l'archive d'un dépôt entier.
 *
 * Le corps est **streamé** : l'archive ne transite jamais entièrement par la
 * mémoire du serveur. La taille annoncée par GitHub est vérifiée avant le
 * premier octet envoyé (plafond `MAX_ARCHIVE_MB`, 250 Mo par défaut).
 *
 * C'est un simple `<a href>` côté client : le navigateur gère donc lui-même la
 * progression et l'enregistrement du fichier.
 */
import { getSession } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { clientIp } from "@/lib/ratelimit";
import { safeRef, streamArchive, type ArchiveFormat } from "@/lib/github";
import { logEvent } from "@/lib/db";
import { toUserMessage, AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ owner: string; repo: string }>;
}

/** En-tête de téléchargement, sûr pour les noms non ASCII (RFC 5987). */
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { owner, repo } = await params;
  const url = new URL(req.url);
  const format: ArchiveFormat =
    url.searchParams.get("format") === "tar.gz" ? "tar.gz" : "zip";

  let ref = "";
  try {
    ref = safeRef(url.searchParams.get("ref"));
  } catch (e) {
    return jsonError(toUserMessage(e), 400);
  }

  try {
    const archive = await streamArchive(session.token, owner, repo, ref, format);

    logEvent({
      kind: "system",
      login: session.login,
      ip: clientIp(req.headers),
      detail: {
        scope: "repo.archive",
        repo: `${owner}/${repo}`,
        format,
        ref: ref || "défaut",
        bytes: archive.contentLength,
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": archive.contentType,
      "Content-Disposition": disposition(archive.filename),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (archive.contentLength > 0) {
      headers["Content-Length"] = String(archive.contentLength);
    }

    return new Response(archive.body, { status: 200, headers });
  } catch (e) {
    const status =
      e instanceof AppError && e.code === "NOT_FOUND"
        ? 404
        : e instanceof AppError && e.code === "RATE_LIMITED"
          ? 429
          : e instanceof AppError &&
              (e.code === "ARCHIVE_TOO_BIG" || e.code === "NAME_INVALID")
            ? 400
            : 500;
    return jsonError(toUserMessage(e), status);
  }
}
