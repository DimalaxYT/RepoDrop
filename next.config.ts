import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Busboy / better-sqlite-like native code and child_process are Node-only:
  // make sure route handlers run in the Node runtime (default) and that
  // heavy libs stay external to the bundler.
  serverExternalPackages: ["node-unrar-js"],
};

export default nextConfig;
