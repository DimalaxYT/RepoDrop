import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Check,
  Eye,
  FileWarning,
  GitBranch,
  Lock,
  MousePointerClick,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    n: "1",
    title: "Connectez GitHub",
    body: "Un simple clic d'autorisation. Nous demandons uniquement le scope « repo » — rien n'est stocké en base.",
    icon: Lock,
  },
  {
    n: "2",
    title: "Déposez l'archive",
    body: "Glissez votre .rar ou .zip. Extraction sandboxée, chemins vérifiés, aperçu complet avant l'envoi.",
    icon: MousePointerClick,
  },
  {
    n: "3",
    title: "Pushez en un clic",
    body: "Créez un nouveau dépôt ou poussez dans un dépôt existant. Le commit est créé avec votre identité GitHub.",
    icon: GitBranch,
  },
] as const;

const FEATURES = [
  {
    icon: Archive,
    title: "RAR natif, sans logiciel",
    body: "Les .rar fonctionnent directement dans le navigateur côté serveur — pas de WinRAR, pas de dézippeur à installer.",
  },
  {
    icon: ShieldCheck,
    title: "Extraction verrouillée",
    body: "Anti zip-slip, anti bombes de décompression, .git embarqué et symlinks écartés. Vos dépôts restent propres.",
  },
  {
    icon: Eye,
    title: "Aperçu avant push",
    body: "Fichiers, poids, dossier racine, node_modules : vous voyez exactement ce qui part, et vous gardez le contrôle.",
  },
  {
    icon: Terminal,
    title: "Zéro ligne de commande",
    body: "Pas de clone, pas de credentials git, pas de « git push -u origin ». L'outil fait tout à votre place.",
  },
  {
    icon: GitBranch,
    title: "Dépôt existant ou neuf",
    body: "Créez un dépôt en privé/public, ou ajoutez l'archive à un dépôt existant — en branche dédiée si vous préférez.",
  },
  {
    icon: FileWarning,
    title: "Limites protectrices",
    body: "200 Mo par archive, 500 Mo décompressés, 20 000 fichiers : le service reste sain, et vous le savez d'avance.",
  },
] as const;

export default async function Home() {
  const session = await getSession();
  const ctaHref = session ? "/import" : "/login";
  const ctaLabel = session ? "Importer une archive" : "Commencer avec GitHub";

  return (
    <main>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero-bg relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center animate-fade-up">
            <Badge variant="sky" className="mb-6">
              <Archive className="h-3.5 w-3.5" />
              .rar &amp; .zip → GitHub
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Vos archives de code,
              <br />
              <span className="text-gradient">sur GitHub en un glisser-déposer.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-mist">
              Recevez un <strong className="text-chalk">.rar</strong> de projet&nbsp;? Connectez
              GitHub, déposez l'archive, choisissez le dépôt — c'est poussé.{" "}
              <span className="whitespace-nowrap">Sans terminal, sans clone, sans configuration.</span>
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href={ctaHref} className={cn(buttonVariants({ size: "lg" }))}>
                {ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#comment" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                Comment ça marche
              </a>
            </div>
            <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-mist">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-go" /> Extraction sandboxée
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-go" /> Jeton GitHub jamais stocké
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-go" /> Interface 100 % française
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- étapes */}
      <section id="comment" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Comment ça marche&nbsp;?
          </h2>
          <p className="mt-3 text-mist">Trois étapes, deux minutes, aucune commande.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="panel relative p-6 transition-colors hover:border-go/30">
              <span className="absolute -top-3 left-6 grid h-6 w-6 place-items-center rounded-full bg-go text-xs font-bold text-ink">
                {s.n}
              </span>
              <s.icon className="mb-4 h-6 w-6 text-go" />
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- features */}
      <section className="border-t border-edge/60 bg-panel/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Conçu pour être simple <span className="text-gradient">et sûr</span>
            </h2>
            <p className="mt-3 text-mist">
              Importer du code doit être un jeu d'enfant — sans transformer le serveur en passoire.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="panel p-6">
                <div className="mb-4 inline-grid h-10 w-10 place-items-center rounded-lg bg-go/10 text-go ring-1 ring-go/20">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ CTA */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="panel relative overflow-hidden p-8 text-center sm:p-14">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_50%_0%,rgba(52,211,153,0.12),transparent)]" />
          <h2 className="relative text-2xl font-semibold tracking-tight sm:text-3xl">
            Prêt à vider votre prochain .rar sur GitHub&nbsp;?
          </h2>
          <p className="relative mx-auto mt-3 max-w-xl text-mist">
            Connectez-vous, déposez, pushez. On s'occupe du reste.
          </p>
          <div className="relative mt-7">
            <Link href={ctaHref} className={cn(buttonVariants({ size: "lg" }))}>
              {ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-edge/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-mist sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} RepoDrop — vos archives, votre GitHub.</span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-go" />
            Jeton en cookie chiffré · aucun stockage serveur
          </span>
        </div>
      </footer>
    </main>
  );
}
