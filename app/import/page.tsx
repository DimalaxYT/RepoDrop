import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { config } from "@/lib/config";
import { Uploader } from "@/components/Uploader";

export const metadata = { title: "Importer" };

export default async function ImportPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const maxLabel = `${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} Mo`;
  const extractLabel = `${Math.round(config.limits.maxExtractBytes / 1024 / 1024)} Mo`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight">Importer une archive</h1>
        <p className="mt-2 text-sm text-mist">
          Déposez un fichier <strong className="text-chalk">.rar</strong> ou{" "}
          <strong className="text-chalk">.zip</strong> contenant votre code. Vous verrez un aperçu
          complet avant tout envoi vers GitHub.
        </p>
      </div>

      <Uploader maxLabel={maxLabel} extractLabel={extractLabel} />

      <ul className="mt-6 grid gap-2 text-xs text-mist sm:grid-cols-3">
        <li className="rounded-lg bg-panel p-3 ring-1 ring-edge">
          <strong className="text-chalk">Limite :</strong> {maxLabel} par archive,{" "}
          {extractLabel} décompressés.
        </li>
        <li className="rounded-lg bg-panel p-3 ring-1 ring-edge">
          <strong className="text-chalk">Sécurité :</strong> chemins vérifiés, .git et symlinks
          écartés.
        </li>
        <li className="rounded-lg bg-panel p-3 ring-1 ring-edge">
          <strong className="text-chalk">Après :</strong> aperçu, choix du dépôt, puis push.
        </li>
      </ul>
    </main>
  );
}
