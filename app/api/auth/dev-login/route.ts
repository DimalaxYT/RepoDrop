/**
 * GET /api/auth/dev-login — connexion directe SANS OAuth (DEV_AUTH=1).
 * Utilise le jeton GitHub présent dans l'environnement du serveur
 * (GH_TOKEN / GITHUB_TOKEN) : sert aux démos et au développement local.
 * Inactif en production tant que DEV_AUTH n'est pas "1".
 */
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getViewer } from "@/lib/github";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!config.devAuth) {
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=devauth", req.url));
  }
  try {
    const viewer = await getViewer(token);
    await setSessionCookie({
      login: viewer.login,
      name: viewer.name || viewer.login,
      avatar: viewer.avatar_url,
      token,
    });
  } catch (e) {
    console.error("[dev-login] /user en échec:", e);
    return NextResponse.redirect(new URL("/login?error=devauth", req.url));
  }
  return NextResponse.redirect(new URL("/import", req.url));
}
