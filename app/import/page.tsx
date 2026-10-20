import { redirect } from "next/navigation";
import { Archive, Eye, FolderArchive, ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/session";
import { config } from "@/lib/config";
import { Uploader } from "@/components/Uploader";
import { formatBytes } from "@/lib/utils";

export const metadata = { title: "Importer" };

export default async function ImportPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const maxLabel = formatBytes(config.limits.maxUploadBytes);
  const extractLabel = formatBytes(config.limits.maxExtractBytes);

  return (
    <main className="relative flex-1 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 hero-bg"
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="mb-8 animate-fade-up">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-go/10 text-go ring-1 ring-go/25">
              <FolderArchive className="h-5 w-5" />
            </span>
            Importer une archive
          </h1>
          <p className="mt-3 text-sm text-mist">
            Déposez un fichier <strong className="text-chalk">.rar</strong>,{" "}
            <strong className="text-chalk">.zip</strong> ou{" "}
            <strong className="text-chalk">.tar</strong> (aussi{" "}
            <strong className="text-chalk">.tar.gz</strong>) contenant votre code.
            Vous verrez un aperçu complet avant tout envoi vers GitHub.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[".rar", ".zip", ".tar", ".tar.gz", ".tgz"].map((ext) => (
              <span
                key={ext}
                className="inline-flex items-center gap-1 rounded-md bg-panel2 px-2 py-1 font-mono text-[11px] text-mist ring-1 ring-edge"
              >
                <Archive className="h-3 w-3 text-go/80" />
                {ext}
              </span>
            ))}
          </div>
        </div>

        <Uploader maxLabel={maxLabel} extractLabel={extractLabel} />

        <ul className="mt-6 grid gap-2 text-xs text-mist sm:grid-cols-3">
          <li className="rounded-lg bg-panel p-3 ring-1 ring-edge">
            <strong className="text-chalk">Limite :</strong> {maxLabel} par
            archive, {extractLabel} décompressés.
          </li>
          <li className="rounded-lg bg-panel p-3 ring-1 ring-edge">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-go" />
            <strong className="text-chalk">Sécurité :</strong> chemins vérifiés,
            .git et liens écartés.
          </li>
          <li className="rounded-lg bg-panel p-3 ring-1 ring-edge">
            <Eye className="mr-1 inline h-3.5 w-3.5 text-go" />
            <strong className="text-chalk">Après :</strong> aperçu, choix du
            dépôt, puis push.
          </li>
        </ul>
      </div>
    </main>
  );
}
