import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, ShieldOff } from "lucide-react";
import { getSession } from "@/lib/session";
import {
  staffAccess,
  staffConfigured,
  staffPasswordUpdatedAt,
} from "@/lib/staff";
import { getString } from "@/lib/settings";
import { ensureWorkerInit } from "@/lib/jobs";
import {
  activityStats,
  countEvents,
  listEventLogins,
  listEvents,
  listPings,
  pingStats,
} from "@/lib/db";
import { discordSettingsView, getDiscordSettings } from "@/lib/settings";
import { getMonitorStatus } from "@/lib/discord/monitor";
import { config } from "@/lib/config";
import { StaffPanel } from "@/components/staff/StaffPanel";
import { StaffGate } from "@/components/staff/StaffGate";
import { buttonVariants } from "@/components/ui/button";
import type { ActivityResponse } from "@/lib/staff-types";
import type { ConfigView } from "@/components/staff/HealthPanel";

export const metadata = {
  title: "Panel staff",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  ensureWorkerInit();

  const session = await getSession();
  if (!session) redirect("/login");

  // Trois états : « denied » (pas staff), « locked » (staff, mot de passe à
  // saisir), « granted ». On reste discret (pas d'indexation, pas d'indice),
  // mais on explique quoi régler si la liste STAFF_LOGINS est vide.
  const access = await staffAccess();
  if (access === "denied") {
    return <NoAccess login={session.login} configured={staffConfigured()} />;
  }
  if (access === "locked") {
    return <StaffGate login={session.login} />;
  }

  const pings = listPings(60);
  const activity: ActivityResponse = {
    events: listEvents({ limit: 25 }),
    total: countEvents({}),
    stats: activityStats(),
    logins: listEventLogins(40),
    pings,
    uptime: pingStats(24 * 3_600_000),
    page: { limit: 25, offset: 0 },
  };

  const configView: ConfigView = {
    appUrl: config.appUrl,
    jobsDir: config.jobsDir,
    maxUploadBytes: config.limits.maxUploadBytes,
    maxExtractBytes: config.limits.maxExtractBytes,
    maxFiles: config.limits.maxFiles,
    pushesPerHour: config.limits.pushesPerHour,
    uploadsPerHour: config.limits.uploadsPerHour,
    devAuth: config.devAuth,
    sessionSecretSet: Boolean(config.sessionSecret),
    staffLogins: config.staffLogins,
    nodeVersion: process.version,
  };

  return (
    <StaffPanel
      activity={activity}
      settings={{
        settings: discordSettingsView(getDiscordSettings()),
        status: getMonitorStatus(),
        staffConfigured: staffConfigured(),
        persistentSecrets: Boolean(config.sessionSecret),
      }}
      pings={pings}
      uptime={activity.uptime}
      configView={configView}
      security={{
        passwordSet:
          Boolean(getString("staff.passwordHash")) ||
          Boolean(config.staffPassword),
        source: getString("staff.passwordHash")
          ? "panel"
          : config.staffPassword
            ? "env"
            : "none",
        updatedAt: await staffPasswordUpdatedAt(),
      }}
      login={session.login}
    />
  );
}

/** Écran affiché à un compte connecté mais non staff. */
function NoAccess({ login, configured }: { login: string; configured: boolean }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-5 px-4 py-24 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger ring-1 ring-danger/30">
        <ShieldOff className="h-7 w-7" />
      </span>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Accès restreint</h1>
        <p className="mt-2 text-sm text-mist">
          Le compte <strong className="text-chalk">{login}</strong> n'est pas
          dans la liste du staff. Cette page n'est pas référencée et son accès
          est contrôlé côté serveur.
        </p>
      </div>

      {!configured && (
        <div className="w-full rounded-xl bg-panel p-4 text-left text-xs leading-relaxed text-mist ring-1 ring-edge">
          <p className="mb-2 flex items-center gap-2 font-medium text-amber">
            <ShieldAlert className="h-4 w-4" />
            Aucun compte staff n'est configuré
          </p>
          <p>
            Ajoutez votre login GitHub dans <code className="text-chalk">.env</code> :
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[11px] text-chalk ring-1 ring-edge">
            STAFF_LOGINS={login}
          </pre>
          <p className="mt-2">
            Puis redémarrez l'application. En mode développement
            (<code className="text-chalk">DEV_AUTH=1</code>), tout compte
            connecté a accès.
          </p>
        </div>
      )}

      <Link href="/" className={buttonVariants({ variant: "secondary" })}>
        Retour à l'accueil
      </Link>
    </main>
  );
}
