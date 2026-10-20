/**
 * POST /api/jobs/[id]/push — lance le push vers GitHub avec les options
 * choisies (aperçu validé côté serveur, jamais de confiance au client).
 */
import { z } from "zod";
import { getSession } from "@/lib/session";
import { json, jsonError } from "@/lib/http";
import { config } from "@/lib/config";
import { frMessage } from "@/lib/errors";
import { countRecentPushes } from "@/lib/db";
import { ensureWorkerInit, enqueuePush, jobOwnedBy } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const pushSchema = z
  .object({
    mode: z.enum(["new", "existing"]),
    name: z.string().trim().max(100).optional(),
    private: z.boolean().optional(),
    repo: z.string().trim().max(140).optional(),
    dedicatedBranch: z.boolean().optional(),
    branchName: z.string().trim().max(100).optional(),
    includeNodeModules: z.boolean().optional(),
    replaceAll: z.boolean().optional(),
    stripRoot: z.boolean().optional(),
    commitMessage: z.string().trim().max(200).optional(),
  })
  .refine((d) => (d.mode === "new" ? Boolean(d.name) : Boolean(d.repo)), {
    message: "Le nom du dépôt est requis pour créer un nouveau dépôt.",
  })
  .refine(
    (d) => !(d.dedicatedBranch && d.branchName && d.branchName.length > 100),
    { message: "Nom de branche trop long." },
  );

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  ensureWorkerInit();

  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const { id } = await params;
  const job = jobOwnedBy(id, session.login);
  if (!job) return jsonError("Job introuvable.", 404);

  // « ready » = premier push. Un job « failed » dont l'aperçu (et donc
  // l'extraction) existe encore peut être RELANCÉ — typiquement en mode
  // « remplacer tout » après un rejet non-fast-forward, sans ré-uploader
  // l'archive. Les dossiers sont purgés ~15 min après l'échec : au-delà,
  // runPush échouera proprement en INTERRUPTED.
  const retryable = job.status === "failed" && job.preview !== null;
  if (job.status !== "ready" && !retryable) {
    return jsonError("Ce job n'est pas prêt à être poussé.", 409);
  }

  // Rate-limit persistant : poussées réussies sur la dernière heure.
  const recent = countRecentPushes(session.login, Date.now() - 3_600_000);
  if (recent >= config.limits.pushesPerHour) {
    return jsonError(frMessage("RATE_LIMITED"), 429, { retryAfterSec: 600 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Corps JSON invalide.", 400);
  }

  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(" ");
    return jsonError(msg || "Options invalides.", 400);
  }

  const opts = parsed.data;
  // Le serveur force les valeurs par défaut de sécurité.
  const pushOpts = {
    ...opts,
    private: opts.private !== false,
    stripRoot: opts.stripRoot !== false,
    includeNodeModules: opts.includeNodeModules === true,
    dedicatedBranch: opts.dedicatedBranch === true,
    replaceAll: opts.replaceAll === true,
  };

  const { updateJob } = await import("@/lib/db");
  updateJob(id, { status: "pushing", push_opts: pushOpts, error: null });
  enqueuePush(id, pushOpts, session.token);

  return json({ id, status: "pushing" }, 202);
}
