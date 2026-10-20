/**
 * Rate-limit à fenêtre glissante, **persisté en base**.
 *
 * La version précédente gardait les compteurs dans une `Map` en mémoire :
 * un redémarrage les remettait à zéro (un attaquant pouvait donc relancer le
 * processus pour retrouver ses essais) et plusieurs processus ne partageaient
 * rien (les limites étaient multipliées par le nombre d'instances).
 *
 * Les horodatages sont stockés dans la table `buckets` (lib/db.ts), avec une
 * durée de vie égale à la fenêtre : une ligne échue disparaît d'elle-même.
 * Le volume est borné par `limit` (quelques dizaines d'entiers par clé).
 *
 * Les poussées gardent en plus leur compteur métier en base
 * (`db.countRecentPushes`), inchangé.
 */
import { bucketDelete, bucketGet, bucketSet } from "./db";

export interface RateResult {
  ok: boolean;
  retryAfterSec: number;
}

/** Horodatages encore dans la fenêtre, du plus ancien au plus récent. */
function readHits(key: string, now: number, windowMs: number): number[] {
  const raw = bucketGet(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && now - n < windowMs);
}

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const hits = readHits(key, now, windowMs);

  if (hits.length >= limit) {
    const oldest = hits[0];
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  bucketSet(key, hits.join(","), windowMs);
  return { ok: true, retryAfterSec: 0 };
}

/** Remet un compteur à zéro (sortie de test, déblocage manuel). */
export function resetRateLimit(key: string): void {
  bucketDelete(key);
}

/** IP du client (derrière le proxy de preview : x-forwarded-for d'abord). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "local";
}
