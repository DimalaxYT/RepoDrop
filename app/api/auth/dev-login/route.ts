/**
 * GET /api/auth/dev-login — connexion directe SANS OAuth (DEV_AUTH=1).
 * Utilise le jeton GitHub présent dans l'environnement du serveur
 * (GH_TOKEN / GITHUB_TOKEN) : sert aux démos et au développement local.
 * Inactif en production tant que DEV_AUTH n'est pas "1".
 */
import { config } from "@/lib/config";
import { getViewer } from "@/lib/github";
import { setSessionCookie } from "@/lib/session";
import { isSecureRequest, redirectTo } from "@/lib/http";
import { clientIp } from "@/lib/ratelimit";
import { logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!config.devAuth) {
    return redirectTo("/login?error=config");
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  if (!token) {
    return redirectTo("/login?error=devauth");
  }
  let viewer: Awaited<ReturnType<typeof getViewer>>;
  try {
    viewer = await getViewer(token);
    await setSessionCookie(
      {
        login: viewer.login,
        name: viewer.name || viewer.login,
        avatar: viewer.avatar_url,
        token,
      },
      isSecureRequest(req),
    );
  } catch (e) {
    console.error("[dev-login] /user en échec:", e);
    return redirectTo("/login?error=devauth");
  }
  logEvent({
    kind: "login",
    login: viewer.login,
    ip: clientIp(req.headers),
    detail: { via: "dev" },
  });
  return redirectTo("/import");
}
