/** GET /api/auth/logout — purge le cookie de session puis redirection. */
import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/", req.url));
}
