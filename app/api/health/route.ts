/**
 * GET /api/health — sonde de disponibilité.
 *
 * C'est l'URL que le bot Discord ping toutes les N minutes. Réponse courte,
 * sans authentification et sans donnée sensible : si cette route répond 200,
 * le process Next tourne et la base est ouverte.
 */
import { json } from "@/lib/http";
import { ensureWorkerInit } from "@/lib/jobs";
import { activityStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    ensureWorkerInit();
    const stats = activityStats();
    return json({
      ok: true,
      service: "repodrop",
      time: Date.now(),
      uptimeSec: Math.round(process.uptime()),
      jobs: stats.totalJobs,
    });
  } catch (e) {
    // Base inaccessible ou autre panne : on le dit clairement (HTTP 503).
    return json(
      {
        ok: false,
        service: "repodrop",
        time: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      },
      503,
    );
  }
}
