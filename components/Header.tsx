import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getSession } from "@/lib/session";
import { GitHubIcon, LogoMark } from "@/components/Brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** En-tête global (server component) — reflète l'état de session. */
export async function Header() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-40 border-b border-edge/70 glass">
      {/* Filet lumineux : rappelle l'accent du produit. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-go/45 to-transparent"
      />
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        {/*
          Marque en deux zones :
            - le LOGO mène au panel staff (porte discrète, sans libellé) ;
            - le NOM « RepoDrop » ramène à l'accueil.
          L'accès à /staff reste vérifié côté serveur (STAFF_LOGINS).
        */}
        <span className="flex items-center gap-2 font-semibold tracking-tight text-chalk">
          <Link
            href="/staff"
            aria-label="Espace réservé"
            title=""
            className="grid h-8 w-8 place-items-center rounded-lg bg-go/15 text-go ring-1 ring-go/30 transition-colors hover:bg-go/25 hover:ring-go/50"
          >
            <LogoMark className="h-5 w-5" />
          </Link>
          <Link href="/" className="transition-opacity hover:opacity-80">
            RepoDrop
          </Link>
        </span>

        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/#comment"
            className="hidden rounded-lg px-3 py-2 text-sm text-mist transition-colors hover:bg-panel2 hover:text-chalk md:inline-block"
          >
            Comment ça marche
          </Link>


          {session ? (
            <>
              <Link
                href="/import"
                className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}
              >
                Importer une archive
              </Link>
              <Link
                href="/import"
                className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "sm:hidden")}
              >
                Importer
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
              <Link
                href="/login"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Connexion
              </Link>
              <Link href="/login" className={cn(buttonVariants({ size: "sm" }))}>
                <GitHubIcon />
                <span className="hidden sm:inline">Commencer</span>
                <ArrowUpRight className="h-3.5 w-3.5 sm:hidden" />
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
