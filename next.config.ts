import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
