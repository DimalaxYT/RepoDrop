/** GET /api/auth/logout — purge le cookie de session puis redirection. */
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { clearSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/", config.appUrl));
}
