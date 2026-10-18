/**
 * GET /api/auth/login — redirige vers l'écran d'autorisation GitHub.
 * Le `state` aléatoire (cookie httpOnly, 10 min) protège contre le CSRF.
 */
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!config.github.configured) {
    // Base = URL entrante : fonctionne derrière un proxy de preview.
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("rd_oauth", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.appUrl.startsWith("https"),
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${config.appUrl.replace(/\/$/, "")}/api/auth/callback`,
    scope: "repo",
    state,
    allow_signup: "true",
  });
  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
