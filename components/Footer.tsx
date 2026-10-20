import Link from "next/link";
import { Archive, FileArchive, FolderArchive, ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/Brand";
import { SecretDoor } from "@/components/SecretDoor";

/**
 * Pied de page global. Il héberge aussi la porte dérobée du panel staff
 * (`SecretDoor`) : le point quasi invisible, tout à droite.
 */
export function Footer() {
  return (
    <footer className="relative mt-auto border-t border-edge/60 bg-ink2/60">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid-bg mask-fade opacity-40" />
      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Wordmark />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-mist">
              Vos archives de code, sur GitHub, en un glisser-déposer. Sans
              terminal, sans clone, sans configuration git.
            </p>
          </div>

          <FooterCol title="Produit">
            <FooterLink href="/">Accueil</FooterLink>
            <FooterLink href="/import">Importer une archive</FooterLink>
            <FooterLink href="/#comment">Comment ça marche</FooterLink>
            <FooterLink href="/#securite">Sécurité</FooterLink>
            <FooterLink href="/staff">Panel staff (dashboard)</FooterLink>
          </FooterCol>

          <FooterCol title="Formats pris en charge">
            <span className="flex items-center gap-2 text-sm text-mist">
              <FileArchive className="h-3.5 w-3.5 text-sky/80" /> .rar (RAR4 &amp; RAR5)
            </span>
            <span className="flex items-center gap-2 text-sm text-mist">
              <Archive className="h-3.5 w-3.5 text-sky/80" /> .zip
            </span>
            <span className="flex items-center gap-2 text-sm text-mist">
              <FolderArchive className="h-3.5 w-3.5 text-go/80" /> .tar · .tar.gz · .tgz
            </span>
          </FooterCol>

          <FooterCol title="Garanties">
            <span className="flex items-start gap-2 text-sm text-mist">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-go" />
              Jeton GitHub chiffré, jamais stocké en base
            </span>
            <span className="flex items-start gap-2 text-sm text-mist">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-go" />
              Extraction sandboxée, chemins vérifiés
            </span>
            <span className="flex items-start gap-2 text-sm text-mist">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-go" />
              Aperçu complet avant tout envoi
            </span>
          </FooterCol>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-edge/60 pt-6 text-xs text-mist sm:flex-row">
          <span>© {new Date().getFullYear()} RepoDrop — vos archives, votre GitHub.</span>
          {/* Le point à droite ouvre /staff (5 clics). Invisible, volontairement. */}
          <SecretDoor />
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-chalk/70">
        {title}
      </p>
      {children}
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm text-mist transition-colors hover:text-chalk"
    >
      {children}
    </Link>
  );
}
