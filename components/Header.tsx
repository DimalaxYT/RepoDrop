import Link from "next/link";
import { getSession } from "@/lib/session";
import { Wordmark, GitHubIcon } from "@/components/Brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** En-tête global (server component) — reflète l'état de session. */
export async function Header() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-40 border-b border-edge/70 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-chalk hover:opacity-90 transition-opacity">
          <Wordmark />
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3">
          {session ? (
            <>
              <Link
                href="/import"
                className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}
              >
                Importer une archive
              </Link>
              <span className="flex items-center gap-2 rounded-full bg-panel2 py-1 pl-1 pr-3 ring-1 ring-edge">
                {session.avatar ? (
                  <img
                    src={session.avatar}
                    alt={`Avatar de ${session.login}`}
                    className="h-6 w-6 rounded-full ring-1 ring-edge"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-go/20 text-xs font-bold text-go">
                    {session.login.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="max-w-28 truncate text-xs font-medium text-chalk/90">
                  {session.login}
                </span>
              </span>
              <a
                href="/api/auth/logout"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Déconnexion
              </a>
            </>
          ) : (
            <>
              <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                Connexion
              </Link>
              <Link href="/login" className={cn(buttonVariants({ size: "sm" }))}>
                <GitHubIcon />
                Commencer
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
