/** GET /api/auth/logout — purge le cookie de session puis redirection. */
import { clearSessionCookie, getSession } from "@/lib/session";
import { redirectTo } from "@/lib/http";
import { clientIp } from "@/lib/ratelimit";
import { logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  await clearSessionCookie();
  logEvent({
    kind: "logout",
    login: session?.login ?? null,
    ip: clientIp(req.headers),
  });
  return redirectTo("/");
}
