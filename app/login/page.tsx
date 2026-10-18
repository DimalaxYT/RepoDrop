import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { config } from "@/lib/config";
import { Wordmark, GitHubIcon } from "@/components/Brand";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Connexion" };

const ERRORS: Record<string, string> = {
  state: "La session de connexion a expiré. Réessayez.",
  oauth: "GitHub a refusé l'autorisation. Réessayez depuis le début.",
  config:
    "L'application n'est pas configurée : renseignez GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET puis relancez.",
  devauth: "Mode dev : le jeton GH_TOKEN du serveur est absent ou invalide.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? "Erreur de connexion." : null;

  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <div className="mb-8 text-center animate-fade-up">
        <Link href="/" className="inline-block">
          <Wordmark className="justify-center text-lg" />
        </Link>
      </div>

      <Card className="animate-fade-up">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl">Connexion à RepoDrop</CardTitle>
          <CardDescription>
            Autorisez l'accès à GitHub pour créer des dépôts et pousser vos archives.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {message && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger ring-1 ring-danger/25"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <a
            href="/api/auth/login"
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            <GitHubIcon className="h-5 w-5" />
            Continuer avec GitHub
          </a>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-mist">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-go" />
            Nous demandons uniquement les scopes <code className="text-chalk">repo</code> et{" "}
            <code className="text-chalk">workflow</code> : créer des dépôts et pousser du code{" "}
            <strong className="text-chalk">en votre nom</strong> (y compris vos fichiers{" "}
            <code className="text-chalk">.github/workflows/</code>). Votre jeton est chiffré
            dans un cookie httpOnly, jamais stocké en base.
          </p>

          {config.devAuth && (
            <div className="mt-2 rounded-xl border border-dashed border-edge p-4 text-center">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-mist">
                Mode développement
              </p>
              <a
                href="/api/auth/dev-login"
                className={cn(buttonVariants({ variant: "secondary" }), "w-full")}
              >
                Connexion directe (GH_TOKEN du serveur)
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
