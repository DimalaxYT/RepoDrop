/** GET /api/jobs/[id] — état du job (statut, aperçu, résultat du push). */
import { getSession } from "@/lib/session";
import { json, jsonError } from "@/lib/http";
import { ensureWorkerInit, jobOwnedBy } from "@/lib/jobs";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  ensureWorkerInit();
  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { id } = await params;
  const job = jobOwnedBy(id, session.login);
  if (!job) return jsonError("Job introuvable.", 404);

  return json({ job });
}
