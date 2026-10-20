/**
 * En-têtes de sécurité HTTP, appliqués à toutes les réponses.
 *
 * Isolé de `next.config.ts` pour être **testable** : la configuration de Next
 * n'est pas chargée par les tests, alors que ce module l'est.
 *
 * Deux limites assumées, documentées ici plutôt que découvertes plus tard :
 *
 * 1. `script-src`/`style-src` contiennent `'unsafe-inline'`. Next.js injecte des
 *    scripts et des styles en ligne au démarrage de l'application ; une CSP
 *    stricte exigerait des nonces posés par un middleware. En l'état, la CSP
 *    bloque quand même le chargement de scripts ou de feuilles de style depuis
 *    une origine tierce, qui est le vecteur principal.
 * 2. La protection anti-clickjacking (`frame-ancestors`) est **opt-in** via
 *    `FRAME_ANCESTORS`. L'application est notamment consultée dans une iframe
 *    d'aperçu dont l'origine diffère de la sienne : interdire le cadrage par
 *    défaut casserait cet usage. En production, poser
 *    `FRAME_ANCESTORS='self'` est recommandé.
 *
 *    ⚠ `FRAME_ANCESTORS` est lu **au moment du build** : Next.js résout
 *    `headers()` pendant `next build` et fige le résultat dans
 *    `.next/routes-manifest.json`. Poser la variable uniquement au démarrage du
 *    serveur n'a donc **aucun effet** — il faut la fournir à la compilation.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeaderOptions {
  /**
   * Sources autorisées à cadrer l'application (directive `frame-ancestors`).
   * Vide ou absent : aucune directive émise.
   */
  frameAncestors?: string;
  /**
   * Environnement courant. En développement, React Refresh (HMR) a besoin
   * d'évaluer du code à la volée : `'unsafe-eval'` est alors ajouté, et retiré
   * en production.
   */
  nodeEnv?: string;
}

/**
 * Politiques de la Content-Security-Policy, hors `frame-ancestors` (qui dépend
 * du déploiement) et hors `script-src` / `connect-src` (qui dépendent de
 * l'environnement).
 *
 * Volontairement absentes : `upgrade-insecure-requests` (casserait un accès
 * http:// légitime, comme l'aperçu de développement) et `report-uri` (aucun
 * collecteur configuré).
 */
const CSP_DIRECTIVES: Record<string, string> = {
  // Par défaut, uniquement l'origine de l'application.
  "default-src": "'self'",
  // Styles injectés en ligne par le framework.
  "style-src": "'self' 'unsafe-inline'",
  // Avatars GitHub (https) et images en data URI ; `https:` plutôt qu'une liste
  // d'hôtes, car l'URL d'avatar vient de l'API GitHub et varie.
  "img-src": "'self' data: https:",
  "font-src": "'self' data:",
  // Appels fetch/XHR vers les routes /api de l'application uniquement.
  // En développement, le rechargement à chaud de Next.js passe par un
  // WebSocket sur la même origine : voir composeConnectSrc().
  "connect-src": "'self'",
  "media-src": "'self'",
  // Aucun plugin embarqué : supprime les vecteurs Flash/Java historiques.
  "object-src": "'none'",
  "base-uri": "'self'",
  "form-action": "'self'",
  // Empêche l'inclusion de la page comme frame par un tiers inconnu quand la
  // directive frame-ancestors n'est pas fournie.
  "frame-src": "'none'",
};

/**
 * Construit la valeur de l'en-tête `Content-Security-Policy`.
 *
 * `script-src` est composé à part : il autorise les scripts en ligne (Next.js
 * en émet au démarrage) et, en développement seulement, `'unsafe-eval'` pour le
 * rechargement à chaud.
 */
export function contentSecurityPolicy(opts: SecurityHeaderOptions = {}): string {
  const isProd = (opts.nodeEnv ?? process.env.NODE_ENV) === "production";

  // Next.js émet des scripts d'amorçage en ligne. En développement, React
  // Refresh évalue aussi du code à la volée.
  const scriptSrc = isProd ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";
  // Le rechargement à chaud de Next.js ouvre un WebSocket sur la même origine.
  const connectSrc = isProd ? "'self'" : "'self' ws:";

  const parts = [`script-src ${scriptSrc}`, `connect-src ${connectSrc}`];
  for (const [name, value] of Object.entries(CSP_DIRECTIVES)) {
    if (name === "connect-src") continue; // déjà traitée ci-dessus
    parts.push(`${name} ${value}`);
  }
  if (opts.frameAncestors) {
    parts.push(`frame-ancestors ${opts.frameAncestors}`);
  }
  return parts.join("; ");
}

/**
 * En-têtes de sécurité à appliquer globalement.
 *
 * `X-Content-Type-Options: nosniff` était déjà posé sur les deux routes de
 * téléchargement ; il est maintenant généralisé, y compris aux réponses HTML.
 */
export function securityHeaders(opts: SecurityHeaderOptions = {}): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    // Empêche le navigateur de « deviner » un type MIME : un fichier téléversé
    // ne peut pas être interprété comme du HTML exécutable.
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Ne divulgue que l'origine aux tiers (les chemins restent privés).
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Désactive le prefetch DNS : l'application n'appelle aucune origine tierce
    // depuis le navigateur.
    { key: "X-DNS-Prefetch-Control", value: "off" },
    // APIs sensibles du navigateur non utilisées par l'application.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
    },
    // Force HTTPS pendant un an, y compris pour les sous-domaines. Ignoré par
    // les navigateurs lorsque la réponse arrive en http (aperçu de dev).
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  ];

  if (opts.frameAncestors) {
    // En-tête historique, pour les navigateurs qui ignorent frame-ancestors.
    headers.push({ key: "X-Frame-Options", value: "SAMEORIGIN" });
  }

  return headers;
}
