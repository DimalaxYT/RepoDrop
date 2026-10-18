/**
 * Rate-limit en mémoire (fenêtre glissante). Simple et suffisant pour v1 ;
 * les poussées ont en plus un compteur persistant en base (db.countRecentPushes).
 */

interface Bucket {
  hits: number[];
}

const store = new Map<string, Bucket>();

export interface RateResult {
  ok: boolean;
  retryAfterSec: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t - now < windowMs);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  bucket.hits.push(now);
  store.set(key, bucket);

  // Nettoyage léger de temps en temps.
  if (store.size > 5000) {
    for (const [k, b] of store) {
      if (b.hits.every((t) => t - now >= windowMs)) store.delete(k);
    }
  }
  return { ok: true, retryAfterSec: 0 };
}

/** IP du client (derrière le proxy de preview : x-forwarded-for d'abord). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "local";
}
