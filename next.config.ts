import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  /**
   * En-têtes de sécurité sur toutes les réponses. La logique vit dans
   * `lib/security-headers.ts` (testée) plutôt qu'ici.
   *
   * `FRAME_ANCESTORS` est opt-in : l'application est consultable dans une iframe
   * d'aperçu dont l'origine diffère de la sienne. En production, poser
   * `FRAME_ANCESTORS='self'` est recommandé.
   *
   * ⚠ Next.js résout `headers()` pendant `next build` : les variables lues ici
   * sont capturées à la **compilation**, pas au démarrage du serveur.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ frameAncestors: process.env.FRAME_ANCESTORS ?? "" }),
      },
    ];
  },

  // Busboy / better-sqlite-like native code and child_process are Node-only:
  // make sure route handlers run in the Node runtime (default) and that
  // heavy libs stay external to the bundler.
  serverExternalPackages: ["node-unrar-js"],
  // En développement, le navigateur accède au serveur via un proxy
  // (preview Arena : https://<port>-<sandbox>.e2b.app). Sans cette liste,
  // Next bloque les ressources /_next/* issues d'une origine non locale.
  allowedDevOrigins: ["*.e2b.app", "127.0.0.1", "0.0.0.0"],
};

export default nextConfig;
