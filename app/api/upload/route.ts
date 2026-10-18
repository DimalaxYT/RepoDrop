/**
 * POST /api/upload — réception d'une archive (.rar/.zip) en multipart.
 *
 * Flux : busboy streame vers /tmp/repodrop-jobs/<id>/upload.<ext>
 * (jamais de buffer complet en mémoire), puis on valide les magic bytes.
 * Le job n'est créé en base qu'une fois l'archive entièrement reçue et
 * validée — une requête invalide ne laisse aucun job orphelin.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { config } from "@/lib/config";
import { json, jsonError } from "@/lib/http";
import { frMessage } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { insertJob } from "@/lib/db";
import { ensureWorkerInit, enqueueExtraction } from "@/lib/jobs";
import { detectFormat } from "@/lib/extract";

export const dynamic = "force-dynamic";

function safeDisplayName(raw: string | undefined): string {
  const base = path.basename(String(raw ?? "")).replace(/[\u0000-\u001f\u007f]/g, "");
  const trimmed = base.slice(0, 150).trim() || "archive";
  return trimmed;
}

export async function POST(req: Request): Promise<Response> {
  ensureWorkerInit();

  const session = await getSession();
  if (!session) return jsonError("Authentification requise.", 401);

  const ip = clientIp(req.headers);
  const rl = rateLimit(`upload:${ip}`, config.limits.uploadsPerHour, 3_600_000);
  if (!rl.ok) {
    return jsonError(frMessage("RATE_LIMITED"), 429, {
      retryAfterSec: rl.retryAfterSec,
    });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError("Requête invalide (multipart/form-data attendu).", 415);
  }
  if (!req.body) return jsonError("Corps de requête vide.", 400);

  const id = crypto.randomUUID();
  const jobPath = path.join(config.jobsDir, id);
  fs.mkdirSync(jobPath, { recursive: true });

  let cleanup = true;
  try {
    const result = await receiveArchive(req, contentType, jobPath);
    if ("error" in result) {
      return jsonError(result.error, result.status, result.extra);
    }

    // Validation des magic bytes APRÈS réception (fichier déjà sur disque).
    const fd = fs.openSync(result.archivePath, "r");
    const head = Buffer.alloc(8);
    const read = fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
    const format = detectFormat(head.subarray(0, read));
    if (!format) {
      return jsonError(
        "Ce fichier n'est pas une archive .zip ou .rar valide.",
        415,
      );
    }
    if (result.size === 0) {
      return jsonError("L'archive est vide.", 400);
    }

    // Nom final attendu par le worker : upload.<format>
    const finalPath = path.join(jobPath, `upload.${format}`);
    fs.renameSync(result.archivePath, finalPath);

    // Tout est bon : on persiste le job et on lance l'extraction en tâche de fond.
    insertJob({
      id,
      login: session.login,
      filename: result.filename,
      format,
      archiveSize: result.size,
      ip,
    });
    cleanup = false;
    enqueueExtraction(id);
    return json({ id }, 202);
  } catch (err) {
    // Limites busboy / erreurs d'E/S.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("size limit")) {
      return jsonError(
        `Archive trop volumineuse (max ${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} Mo).`,
        413,
      );
    }
    console.error("[upload] erreur:", msg);
    return jsonError("Réception du fichier impossible. Réessayez.", 500);
  } finally {
    if (cleanup) {
      fs.rmSync(jobPath, { recursive: true, force: true });
    }
  }
}

interface ReceiveOk {
  archivePath: string;
  filename: string;
  size: number;
}
type ReceiveErr = {
  error: string;
  status: number;
  extra?: Record<string, unknown>;
};

async function receiveArchive(
  req: Request,
  contentType: string,
  jobPath: string,
): Promise<ReceiveOk | ReceiveErr> {
  return new Promise<ReceiveOk | ReceiveErr>((resolve, reject) => {
    let settled = false;
    const done = (v: ReceiveOk | ReceiveErr) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const bb = Busboy({
      headers: { "content-type": contentType },
      limits: {
        files: 1,
        fields: 4,
        fileSize: config.limits.maxUploadBytes,
      },
    });

    let fileSeen = false;
    let fieldName = "";

    bb.on("file", (_name, stream, info) => {
      fileSeen = true;
      fieldName = info.filename ?? "";
      const target = path.join(jobPath, "upload.part");
      let tooLarge = false;
      stream.on("limit", () => {
        tooLarge = true;
      });

      pipeline(stream, fs.createWriteStream(target, { flags: "w" }))
        .then(() => {
          if (tooLarge) {
            done({
              error: `Archive trop volumineuse (max ${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} Mo).`,
              status: 413,
            });
            return;
          }
          const size = fs.statSync(target).size;
          if (size === 0) {
            done({ error: "L'archive est vide.", status: 400 });
            return;
          }
          const displayName = safeDisplayName(fieldName);
          const archivePath = path.join(jobPath, "upload.tmp");
          fs.renameSync(target, archivePath);
          done({ archivePath, filename: displayName, size });
        })
        .catch((e) => {
          if (!settled) reject(e);
        });
    });

    bb.on("field", () => {
      /* champs ignorés */
    });

    bb.on("error", (e) => {
      if (!settled) reject(e);
    });

    bb.on("close", () => {
      if (!settled && !fileSeen) {
        done({ error: "Aucun fichier reçu.", status: 400 });
      }
    });

    const body = req.body;
    if (!body) {
      done({ error: "Corps de requête vide.", status: 400 });
      return;
    }
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(bb);
  });
}
