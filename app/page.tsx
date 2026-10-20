import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Check,
  Eye,
  FileArchive,
  FileWarning,
  FolderArchive,
  Gauge,
  GitBranch,
  Lock,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { isStaffLogin } from "@/lib/staff";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    n: "1",
    title: "Connectez GitHub",
    body: "Un simple clic d'autorisation. Nous demandons uniquement les scopes nécessaires — votre jeton reste chiffré dans votre navigateur.",
    icon: Lock,
  },
  {
    n: "2",
    title: "Déposez l'archive",
    body: "Glissez votre .rar, .zip ou .tar. Extraction sandboxée, chemins vérifiés, aperçu complet avant l'envoi.",
    icon: MousePointerClick,
  },
  {
    n: "3",
    title: "Pushez en un clic",
    body: "Créez un dépôt ou poussez dans un dépôt existant. Le commit est créé avec votre identité GitHub.",
    icon: GitBranch,
  },
] as const;

const FEATURES = [
  {
    icon: Archive,
    title: "RAR, ZIP et TAR natifs",
    body: "Les .rar (RAR4/RAR5), .zip et .tar/.tar.gz s'ouvrent côté serveur — aucun logiciel à installer, nulle part.",
  },
  {
    icon: ShieldCheck,
    title: "Extraction verrouillée",
    body: "Anti zip-slip, anti bombes de décompression, .git embarqué et liens symboliques écartés. Vos dépôts restent propres.",
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
    body: "Créez un dépôt privé ou public, ou ajoutez l'archive à un dépôt existant — en branche dédiée si vous préférez.",
  },
  {
    icon: Sparkles,
    title: "Liens prêts pour une IA",
    body: "Après le push : Codespaces, vscode.dev, URL de clone, commande gh et archive .zip. Un copier-coller suffit.",
  },
] as const;

const GUARANTEES = [
  {
    icon: ShieldCheck,
    title: "Zip-slip & traversal",
    body: "Chaque chemin est validé (../, absolus, UNC, NUL). Une seule tentative et l'archive entière est refusée.",
  },
  {
    icon: FileWarning,
    title: "Bombes de décompression",
    body: "Les tailles déclarées sont cumulées avant écriture : 500 Mo décompressés et 20 000 fichiers au maximum.",
  },
  {
    icon: Lock,
    title: "Jeton GitHub",
    body: "Cookie httpOnly chiffré (JWE A256GCM), push via GIT_ASKPASS. Jamais en base, jamais dans les logs.",
  },
  {
    icon: Gauge,
    title: "Quotas",
    body: "30 uploads/h par IP et 10 push/h par utilisateur, compteurs persistants : le service reste sain.",
  },
] as const;

export default async function Home() {
  const session = await getSession();
  const ctaHref = session ? "/import" : "/login";
  const ctaLabel = session ? "Importer une archive" : "Commencer avec GitHub";
  // Le bouton « Dashboard » est visible pour tout le monde ; l'accès réel à
  // /staff reste vérifié côté serveur (STAFF_LOGINS).
  const staff = isStaffLogin(session?.login);

  return (
    <main className="flex-1">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hero-bg" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 grid-bg mask-fade opacity-70"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-72 w-[46rem] -translate-x-1/2 rounded-full bg-go/10 blur-[120px] animate-aurora"
        />

        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28">
          <div className="animate-fade-up">
            <Badge variant="sky" className="mb-6">
              <FolderArchive className="h-3.5 w-3.5" />
              Nouveau : .tar et .tar.gz
            </Badge>
            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
              Vos archives de code,
              <br />
              <span className="text-gradient">sur GitHub en un glisser-déposer.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist">
              Recevez un <strong className="text-chalk">.rar</strong>, un{" "}
              <strong className="text-chalk">.zip</strong> ou un{" "}
              <strong className="text-chalk">.tar</strong> de projet&nbsp;? Connectez
              GitHub, déposez l'archive, choisissez le dépôt — c'est poussé. Sans
              terminal, sans clone, sans configuration.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={ctaHref} className={cn(buttonVariants({ size: "lg" }))}>
                {ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#comment"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                Comment ça marche
              </a>
              <Link
                href="/staff"
                className={cn(
                  buttonVariants({
                    variant: staff ? "secondary" : "ghost",
                    size: "lg",
                  }),
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                Dashboard
                {staff && (
                  <span className="ml-0.5 rounded-full bg-grape/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-grape ring-1 ring-grape/30">
                    staff
                  </span>
                )}
              </Link>
            </div>

            <ul className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-mist">
              <li className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-go" /> Extraction sandboxée
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-go" /> Jeton GitHub jamais stocké
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-go" /> Interface 100 % française
              </li>
            </ul>
          </div>

          <HeroMock />
        </div>
      </section>

      {/* ---------------------------------------------------------- bandeau */}
      <section className="border-y border-edge/60 bg-ink2/50">
        <div className="mx-auto grid max-w-6xl gap-px overflow-hidden px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <Stat value="3" label="formats d'archives" sub=".rar · .zip · .tar[.gz]" />
          <Stat value="0" label="ligne de commande" sub="tout se fait au clic" />
          <Stat value="2 min" label="du dépôt au push" sub="aperçu inclus" />
          <Stat value="100 %" label="français" sub="interface et messages" />
        </div>
      </section>

      {/* ---------------------------------------------------------- étapes */}
      <section id="comment" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Comment ça marche&nbsp;?
          </h2>
          <p className="mt-3 text-mist">Trois étapes, deux minutes, aucune commande.</p>
        </div>
        <div className="relative grid gap-5 md:grid-cols-3">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-8 right-8 top-9 hidden h-px bg-gradient-to-r from-go/0 via-go/40 to-go/0 md:block"
          />
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="panel group relative p-6 transition-all duration-300 hover:-translate-y-1 hover:border-go/30"
            >
              <span className="absolute -top-3.5 left-6 grid h-7 w-7 place-items-center rounded-full bg-go text-xs font-bold text-ink shadow-[0_0_20px_-4px_rgba(52,211,153,0.8)]">
                {s.n}
              </span>
              <s.icon className="mb-4 h-6 w-6 text-go transition-transform duration-300 group-hover:scale-110" />
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- features */}
      <section className="border-t border-edge/60 bg-ink2/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Conçu pour être simple <span className="text-gradient">et sûr</span>
            </h2>
            <p className="mt-3 text-mist">
              Importer du code doit être un jeu d'enfant — sans transformer le
              serveur en passoire.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="panel group p-6 transition-all duration-300 hover:-translate-y-1 hover:border-sky/30"
              >
                <div className="mb-4 inline-grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-go/15 to-sky/10 text-go ring-1 ring-go/20 transition-colors group-hover:text-sky group-hover:ring-sky/30">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- formats */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="panel relative overflow-hidden p-8 sm:p-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid-bg opacity-40 mask-fade"
          />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Une archive, quel que soit son âge
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
                Les vieux <code className="text-chalk">.rar</code> de Windows, les{" "}
                <code className="text-chalk">.zip</code> d'un export, les{" "}
                <code className="text-chalk">.tar.gz</code> d'un serveur Linux :
                tout est lu côté serveur, en streaming, avec les mêmes garde-fous.
                Le dossier racine unique est retiré automatiquement, et{" "}
                <code className="text-chalk">node_modules</code> est exclu par défaut.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[".rar", ".zip", ".tar", ".tar.gz", ".tgz"].map((ext) => (
                <span
                  key={ext}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-panel2 px-3 py-2 font-mono text-sm text-chalk ring-1 ring-edge"
                >
                  <FileArchive className="h-3.5 w-3.5 text-go" />
                  {ext}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- sécurité */}
      <section
        id="securite"
        className="scroll-mt-24 border-t border-edge/60 bg-ink2/40"
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Ce qu'on refuse, et pourquoi
            </h2>
            <p className="mt-3 text-mist">
              Décompresser l'archive d'un inconnu est un sport à risque. Voilà les
              filets tendus sous chaque import.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {GUARANTEES.map((g) => (
              <div key={g.title} className="panel flex gap-4 p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/10 text-go ring-1 ring-go/20">
                  <g.icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{g.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-mist">{g.body}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-mist">
            Limites par défaut : 200 Mo uploadés, 500 Mo décompressés, 20 000
            fichiers — ajustables par variables d'environnement.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ CTA */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="panel relative overflow-hidden p-8 text-center sm:p-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_50%_0%,rgba(52,211,153,0.14),transparent)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-sky/10 blur-[100px]"
          />
          <h2 className="relative text-2xl font-semibold tracking-tight sm:text-3xl">
            Prêt à vider votre prochaine archive sur GitHub&nbsp;?
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
    </main>
  );
}

/* ------------------------------------------------------------------ briques */

function Stat({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="px-2 py-8 text-center sm:px-6">
      <div className="text-3xl font-bold tracking-tight text-gradient">{value}</div>
      <div className="mt-1 text-sm font-medium text-chalk/90">{label}</div>
      <div className="mt-0.5 font-mono text-[11px] text-mist">{sub}</div>
    </div>
  );
}

/**
 * Maquette animée du produit (décorative) : dépôt de l'archive, extraction,
 * push réussi. Aucun JavaScript — uniquement des animations CSS.
 */
function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-md animate-fade-up lg:max-w-none">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-go/10 via-transparent to-sky/10 blur-2xl"
      />
      <div className="panel overflow-hidden p-4 animate-float">
        {/* barre de fenêtre */}
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-go/60" />
          <span className="ml-2 truncate font-mono text-[11px] text-mist">
            repodrop · import
          </span>
        </div>

        {/* zone de dépôt */}
        <div className="rounded-xl border-2 border-dashed border-go/40 bg-go/[0.06] p-5 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-go/15 text-go ring-1 ring-go/30 animate-pulse-ring">
            <FolderArchive className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-chalk">mon-projet.tar</p>
          <p className="mt-1 font-mono text-[11px] text-mist">18,4 Mo · 1 284 fichiers</p>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-panel2">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-go to-sky animate-indeterminate" />
          </div>
        </div>

        {/* aperçu */}
        <div className="mt-3 rounded-xl bg-ink/70 p-3 font-mono text-[11px] ring-1 ring-edge">
          <TreeLine depth={0} name="src/" dir />
          <TreeLine depth={1} name="index.ts" size="4,2 Ko" />
          <TreeLine depth={1} name="server.ts" size="12,8 Ko" />
          <TreeLine depth={0} name="package.json" size="1,1 Ko" />
          <TreeLine depth={0} name="node_modules/" dir muted note="exclu" />
        </div>

        {/* résultat */}
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-go/10 px-3 py-2.5 ring-1 ring-go/25">
          <Check className="h-4 w-4 shrink-0 text-go" />
          <span className="truncate text-xs text-go">
            Poussé sur github.com/vous/mon-projet · branche main
          </span>
        </div>
      </div>
    </div>
  );
}

function TreeLine({
  depth,
  name,
  size,
  dir,
  muted,
  note,
}: {
  depth: number;
  name: string;
  size?: string;
  dir?: boolean;
  muted?: boolean;
  note?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-0.5"
      style={{ paddingLeft: depth * 12 }}
    >
      <span className={cn("truncate", dir ? "text-sky/80" : "text-mist", muted && "line-through opacity-60")}>
        {name}
      </span>
      <span className="shrink-0 text-mist/60">
        {note ?? size ?? ""}
      </span>
    </div>
  );
}
