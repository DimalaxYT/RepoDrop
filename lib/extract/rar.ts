/**
 * Extraction .rar — lancement du worker enfant (scripts/rar-extract.mjs).
 *
 * Isolation choix :
 *  - unrar tourne en WASM dans un process dédié : fuite mémoire / OOM / boucle
 *    ne peuvent pas faire tomber le serveur ;
 *  - timeout dur (SIGKILL) ;
 *  - sortie = 1 ligne JSON bornée.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { AppError } from "../errors";
import type { ExtractLimits, ExtractResult } from "./types";

const STDOUT_CAP = 64 * 1024 * 1024; // borné (entries + JSON)
const TIMEOUT_MS = 180_000;

export function extractRar(
  archivePath: string,
  destDir: string,
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const script = path.join(process.cwd(), "scripts", "rar-extract.mjs");
  const args = [
    script,
    archivePath,
    destDir,
    String(limits.maxExtractBytes),
    String(limits.maxFiles),
    String(limits.maxDepth),
    String(limits.maxPathLength),
  ];

  return new Promise<ExtractResult>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }, // pas de token ici : le worker n'en a pas besoin
    });

    let out = "";
    let err = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new AppError("TIMEOUT")));
    }, TIMEOUT_MS);

    child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
      if (out.length > STDOUT_CAP) {
        child.kill("SIGKILL");
        finish(() => reject(new AppError("CORRUPT", undefined, "sortie trop volumineuse")));
      }
    });
    child.stderr.on("data", (c: Buffer) => {
      if (err.length < 64 * 1024) err += c.toString("utf8");
    });

    child.on("error", (e) => {
      finish(() => reject(new AppError("INTERNAL", undefined, String(e.message))));
    });

    child.on("close", (code) => {
      finish(() => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(out);
        } catch {
          /* sortie non-JSON */
        }
        const obj = parsed as
          | (ExtractResult & { ok: true })
          | { ok: false; code?: string; detail?: string }
          | null;

        if (code === 0 && obj && obj.ok === true) {
          resolve({
            fileCount: obj.fileCount,
            totalSize: obj.totalSize,
            entries: obj.entries,
            ignored: obj.ignored,
          });
          return;
        }
        if (obj && obj.ok === false) {
          reject(
            new AppError(
              (obj.code as AppError["code"]) ?? "CORRUPT",
              undefined,
              obj.detail,
            ),
          );
          return;
        }
        reject(
          new AppError("CORRUPT", undefined, err.trim().split("\n").slice(-1)[0] ?? ""),
        );
      });
    });
  });
}
