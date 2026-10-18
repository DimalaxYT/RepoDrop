/**
 * GET /api/auth/callback — échange du code OAuth contre un jeton,
 * création de la session (cookie chiffré), redirection vers /import.
 */
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { getViewer } from "@/lib/github";
import { setSessionCookie } from "@/lib/session";
import { isSecureRequest, redirectTo } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("rd_oauth")?.value;

  // Redirections RELATIVES : le navigateur les résout sur l'origine courante
  // (compatible proxy de preview) ; seul redirect_uri (envoyé à GitHub) doit
  // correspondre à APP_URL.
  const fail = (reason: string) => redirectTo(`/login?error=${reason}`);

  if (!code || !state || !expected || state !== expected) {
    return fail("state");
  }
  jar.delete("rd_oauth");

  if (!config.github.configured) return fail("config");

  // Échange du code (Accept: json obligatoire : GitHub répond du form sinon).
  let token: string | undefined;
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
        redirect_uri: `${config.appUrl.replace(/\/$/, "")}/api/auth/callback`,
      }),
      cache: "no-store",
    });
    const body = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    token = body.access_token;
    if (!token) {
      console.error("[oauth] refus du jeton:", body.error ?? "inconnu");
      return fail("oauth");
    }
  } catch (e) {
    console.error("[oauth] erreur d'échange:", e);
    return fail("oauth");
  }

  try {
    const viewer = await getViewer(token);
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
    console.error("[oauth] /user en échec:", e);
    return fail("oauth");
  }

  return redirectTo("/import");
}
