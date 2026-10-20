import { redirect } from "next/navigation";
import Link from "next/link";
import { FolderSearch, UploadCloud } from "lucide-react";
import { getSession } from "@/lib/session";
import { RepoBrowser } from "@/components/repos/RepoBrowser";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Mes dépôts",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="relative flex-1 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 hero-bg"
      />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-6 animate-fade-up">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky/10 text-sky ring-1 ring-sky/25">
                  <FolderSearch className="h-5 w-5" />
                </span>
                Mes dépôts
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
                Parcourez le contenu de vos dépôts avant d'importer quoi que ce
                soit : arborescence, aperçu des fichiers, branche de votre choix.
                Renommage, visibilité et suppression sont disponibles depuis
                l'onglet <strong className="text-chalk">Actions</strong> d'un
                dépôt.
              </p>
            </div>
            <Link
              href="/import"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              <UploadCloud className="h-4 w-4" />
              Importer une archive
            </Link>
          </div>
        </div>

        <RepoBrowser login={session.login} />
      </div>
    </main>
  );
}
