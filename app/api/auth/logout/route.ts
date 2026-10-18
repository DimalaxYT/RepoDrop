/** GET /api/auth/logout — purge le cookie de session puis redirection. */
import { clearSessionCookie } from "@/lib/session";
import { redirectTo } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await clearSessionCookie();
  return redirectTo("/");
}
