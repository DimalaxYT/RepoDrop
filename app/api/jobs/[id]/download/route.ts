/**
 * GET /api/jobs/[id]/download — télécharge le code extrait du job en .zip.
 *
 * Le zip est reconstruit depuis l'espace d'extraction (sécurité déjà faite :
 * pas de symlink, pas de `.git`, pas de traversal). node_modules est exclu
 * par défaut.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { AppError, frMessage, toUserMessage } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { jsonError } from "@/lib/http";
import { jobOwnedBy } from "@/lib/jobs";
import { zipJob } from "@/lib/zip";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { id } = await params;
  const job = jobOwnedBy(id, session.login);
  if (!job) return jsonError("Job introuvable.", 404);

  // Le zip n'a de sens que si l'extraction est disponible.
  if (job.status !== "done" && job.status !== "ready") {
    return jsonError("Ce job n'est pas encore prêt.", 409);
  }

  const jobDir = path.join(config.jobsDir, id);
  let src: string | null = path.join(jobDir, "extract");
  if (job.preview?.singleRootDir) {
    src = path.join(src, job.preview.singleRootDir);
  }
  const st = await fs.stat(src).catch(() => null);
  if (!st?.isDirectory()) {
    return jsonError(frMessage("INTERRUPTED"), 410);
  }

  try {
    const { path: zipPath, name } = await zipJob(id, src, job.filename, false);
    return new Response(await fs.readFile(zipPath), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return jsonError(toUserMessage(err), err instanceof AppError ? 500 : 502);
  }
}
