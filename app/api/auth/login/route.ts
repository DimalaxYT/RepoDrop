/**
 * GET /api/auth/login — redirige vers l'écran d'autorisation GitHub.
 * Le `state` aléatoire (cookie httpOnly, 10 min) protège contre le CSRF.
 */
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { isSecureRequest, redirectTo } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!config.github.configured) {
    // Redirection relative : le navigateur la résout sur l'origine courante.
    return redirectTo("/login?error=config");
  }

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("rd_oauth", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${config.appUrl.replace(/\/$/, "")}/api/auth/callback`,
    // « repo » : lecture/écriture des dépôts.
    // « workflow » : obligatoire pour écrire un fichier .github/workflows/*
    //   (sans lui, GitHub rejette le push : « refusing to allow an OAuth App
    //   to create or update workflow … without 'workflow' scope »).
    // `delete_repo` est indispensable à l'action « Supprimer le dépôt » du
    // navigateur de dépôts : sans lui GitHub répond 404 (et non 403).
    // Un compte déjà connecté doit se reconnecter pour l'obtenir.
    scope: "repo workflow delete_repo",
    state,
    allow_signup: "true",
  });
  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
