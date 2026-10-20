"use client";

/**
 * Réglages du bot Discord — le jeton se configure ICI, depuis le dashboard.
 *
 * Le jeton est write-only : le serveur ne le renvoie jamais, seulement un
 * masque (`mtok…••••1a2b`). Laisser le champ vide conserve la valeur stockée ;
 * le bouton « Effacer » la supprime.
 *
 * Les champs sont **hydratés depuis le serveur au montage** : changer d'onglet
 * démontait ce composant et son remontage repartait des propriétés du
 * chargement de page (données d'avant sauvegarde) — un « Enregistrer »
 * depuis ce formulaire périmé écrasait le canal / la mention et désactivait
 * le bot, donnant l'impression que tout avait été supprimé.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  Bot,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  PlugZap,
  Radio,
  Save,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn, formatDateTime, timeAgo, timeUntil } from "@/lib/utils";
import type {
  DiscordSettingsView,
  MonitorStatus,
  StaffSettingsResponse,
} from "@/lib/staff-types";

const PRESETS = [5, 10, 15, 30, 60];

export function DiscordSettings({
  initial,
}: {
  initial: StaffSettingsResponse;
}) {
  const [settings, setSettings] = useState<DiscordSettingsView>(initial.settings);
  const [status, setStatus] = useState<MonitorStatus>(initial.status);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [channelId, setChannelId] = useState(initial.settings.channelId);
  const [intervalMin, setIntervalMin] = useState(String(initial.settings.intervalMin));
  const [probeUrl, setProbeUrl] = useState(initial.settings.probeUrl);
  const [roleMention, setRoleMention] = useState(initial.settings.roleMention);
  const [heartbeat, setHeartbeat] = useState(initial.settings.heartbeat);
  const [notifyPush, setNotifyPush] = useState(initial.settings.notifyPush);
  const [alertOnDown, setAlertOnDown] = useState(initial.settings.alertOnDown);
  const [enabled, setEnabled] = useState(initial.settings.enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  // Erreur du rafraîchissement automatique : sans elle, une session expirée ou
  // un serveur en erreur figeait le panneau « État du bot » sans aucun indice.
  const [statusError, setStatusError] = useState<string | null>(null);
  // true = les champs du formulaire reflètent la base (1ʳᵉ lecture réussie).
  // Tant que c'est faux, l'enregistrement est bloqué : sauvegarder un
  // formulaire jamais hydraté écraserait les réglages serveur avec des vides.
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  /** Applique les réglages serveur au formulaire + à l'aperçu (pas au jeton). */
  const applySettings = useCallback((s: DiscordSettingsView) => {
    setSettings(s);
    setChannelId(s.channelId);
    setIntervalMin(String(s.intervalMin));
    setProbeUrl(s.probeUrl);
    setRoleMention(s.roleMention);
    setHeartbeat(s.heartbeat);
    setNotifyPush(s.notifyPush);
    setAlertOnDown(s.alertOnDown);
    setEnabled(s.enabled);
    hydratedRef.current = true;
    setHydrated(true);
  }, []);

  // Rafraîchissement automatique :
  //  - à CHAQUE cycle : l'état du moniteur (badges, prochain ping, compteurs) ;
  //  - au PREMIER cycle réussi seulement : les champs du formulaire, remplis
  //    depuis la base. Les cycles suivants n'y touchent jamais (la saisie en
  //    cours ne doit pas être écrasée).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/settings", { cache: "no-store" });
      if (!res.ok) {
        setStatusError(
          res.status === 401 || res.status === 403
            ? "Session expirée (ou panel verrouillé) : reconnectez-vous pour suivre l'état du bot."
            : `Actualisation impossible (HTTP ${res.status}).`,
        );
        return;
      }
      const body = (await res.json()) as Partial<StaffSettingsResponse>;
      setStatusError(null);
      if (body.status) setStatus(body.status);
      if (!hydratedRef.current && body.settings) {
        // Le champ `token` n'est JAMAIS touché : il est write-only côté
        // serveur, et une saisie déjà commencée ne doit pas être perdue.
        applySettings(body.settings);
      }
    } catch {
      setStatusError("Actualisation impossible (serveur injoignable).");
    }
  }, [applySettings]);

  useEffect(() => {
    void refresh(); // hydration immédiate au montage (attendre 10 s laissait
    //                   le temps de cliquer « Enregistrer » sur un formulaire vide)
    const iv = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const save = async (
    patch: Record<string, unknown>,
    label = "Réglages enregistrés.",
  ): Promise<boolean> => {
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch("/api/staff/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json()) as
        | { settings?: DiscordSettingsView; status?: MonitorStatus; error?: string };
      if (!res.ok) {
        setMessage({ kind: "err", text: body.error ?? `HTTP ${res.status}` });
        return false;
      }
      if (body.settings) {
        // Renvoie la vérité serveur au formulaire (valeurs bornées, jeton
        // consigné…) — et marque l'hydratation comme faite si la sauvegarde
        // a devancé le premier refresh.
        applySettings(body.settings);
        setToken("");
      }
      if (body.status) setStatus(body.status);
      setMessage({ kind: "ok", text: label });
      return true;
    } catch {
      setMessage({ kind: "err", text: "Enregistrement impossible (réseau)." });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const action = async (actionName: string, okText: string): Promise<void> => {
    setBusy(actionName);
    setMessage(null);
    try {
      const res = await fetch("/api/staff/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName }),
      });
      const body = (await res.json()) as {
        error?: string;
        status?: MonitorStatus;
        bot?: { username: string };
        channel?: { name: string } | null;
        probe?: { ok: boolean; latencyMs: number | null; status: number | null };
        sent?: boolean;
      };
      if (!res.ok) {
        setMessage({ kind: "err", text: body.error ?? `HTTP ${res.status}` });
        return;
      }
      if (body.status) setStatus(body.status);
      let text = okText;
      if (body.bot) {
        text = `Jeton valide — bot « ${body.bot.username} »${
          body.channel ? `, canal « ${body.channel.name} »` : ""
        }.`;
      }
      if (body.probe) {
        text = `Site ${body.probe.ok ? "joignable" : "INJOIGNABLE"} en ${
          body.probe.latencyMs ?? "?"
        } ms${body.sent ? " — message envoyé sur Discord." : " — message non envoyé."}`;
      }
      setMessage({ kind: "ok", text });
    } catch {
      setMessage({ kind: "err", text: "Action impossible (réseau)." });
    } finally {
      setBusy(null);
    }
  };

  const saveAll = (): void => {
    const patch: Record<string, unknown> = {
      enabled,
      channelId,
      intervalMin: Math.min(1440, Math.max(1, Number(intervalMin) || 10)),
      heartbeat,
      notifyPush,
      alertOnDown,
      probeUrl,
      roleMention,
    };
    if (token.trim() !== "") patch.token = token.trim();
    void save(patch, "Réglages enregistrés et bot redémarré.");
  };

  const configured = settings.tokenSet;
  const webhook = settings.tokenKind === "webhook";

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      {/* ---------------------------------------------------------- réglages */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-violet-300" />
            Bot Discord
          </CardTitle>
          <CardDescription>
            Collez le <strong className="text-chalk">jeton du bot</strong> (Portail
            développeurs Discord → Bot → Reset Token) ou l'URL d'un webhook. Le
            jeton est chiffré en base et n'est plus jamais réaffiché.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!initial.persistentSecrets && (
            <p className="rounded-lg bg-amber/10 p-3 text-xs leading-relaxed text-amber ring-1 ring-amber/30">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
              <code>SESSION_SECRET</code> n'est pas défini : la clé de chiffrement
              est régénérée à chaque démarrage, le jeton sera perdu au prochain
              redémarrage. Renseignez <code>SESSION_SECRET</code> dans
              <code> .env</code>.
            </p>
          )}

          <Field
            label="Jeton du bot (ou URL de webhook)"
            hint={
              settings.tokenSet
                ? `Enregistré : ${settings.tokenMasked}`
                : "Aucun jeton enregistré."
            }
            icon={<KeyRound className="h-4 w-4" />}
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    settings.tokenSet ? "Laisser vide pour conserver" : "MTok… ou https://discord.com/api/webhooks/…"
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className={cn("pr-10", webhook && "font-mono text-xs")}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-mist hover:text-chalk"
                  aria-label={showToken ? "Masquer" : "Afficher"}
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {settings.tokenSet && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() =>
                    void save({ token: "" }, "Jeton supprimé. Le bot est arrêté.")
                  }
                  title="Supprimer le jeton enregistré"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </Field>

          <Field
            label="Identifiant du canal"
            hint={
              webhook
                ? "Inutile avec un webhook : l'URL contient déjà le canal."
                : "Clic droit sur le canal → « Copier l'identifiant » (mode développeur activé)."
            }
          >
            <Input
              value={channelId}
              onChange={(e) => setChannelId(e.target.value.replace(/\D/g, "").slice(0, 25))}
              placeholder="1234567890123456789"
              inputMode="numeric"
              className="font-mono"
            />
          </Field>

          <Field label="Période du ping" hint="Le bot sonde le site et publie l'état à cette fréquence.">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={1}
                max={1440}
                value={intervalMin}
                onChange={(e) => setIntervalMin(e.target.value)}
                className="w-28"
              />
              <span className="text-sm text-mist">minutes</span>
              <div className="flex gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setIntervalMin(String(p))}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs ring-1 transition-colors",
                      Number(intervalMin) === p
                        ? "bg-go/15 text-go ring-go/40"
                        : "bg-panel2 text-mist ring-edge hover:text-chalk",
                    )}
                  >
                    {p} min
                  </button>
                ))}
              </div>
            </div>
          </Field>

          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle
              label="Ping périodique"
              desc="Publier l'état à chaque sonde"
              checked={heartbeat}
              onChange={setHeartbeat}
            />
            <Toggle
              label="Annoncer les push"
              desc="Qui a poussé, où, quand"
              checked={notifyPush}
              onChange={setNotifyPush}
            />
            <Toggle
              label="Alerte si HS"
              desc="Message + mention en cas de panne"
              checked={alertOnDown}
              onChange={setAlertOnDown}
            />
          </div>

          <Field
            label="Mention en cas de panne"
            hint="Ex. : @here, ou <@&1234567890> pour mentionner un rôle."
          >
            <Input
              value={roleMention}
              onChange={(e) => setRoleMention(e.target.value)}
              placeholder="@here"
            />
          </Field>

          <Field
            label="URL sondée (avancé)"
            hint={`Vide = ${status.probeUrl}`}
          >
            <Input
              value={probeUrl}
              onChange={(e) => setProbeUrl(e.target.value)}
              placeholder="https://mon-site.example/api/health"
              className="font-mono text-xs"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-4">
            <Switch
              checked={enabled}
              onChange={setEnabled}
              label="Activer le bot"
            />
            <span className="text-sm text-chalk/90">
              {enabled ? "Bot actif" : "Bot désactivé"}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={saveAll}
                disabled={busy !== null || !hydrated}
                title={
                  hydrated
                    ? undefined
                    : "Récupération des réglages en cours… (réessayez dans un instant)"
                }
              >
                {busy === "save" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Enregistrer
              </Button>
            </div>
          </div>

          {message && (
            <p
              role="status"
              className={cn(
                "rounded-lg p-3 text-xs ring-1 animate-fade-in",
                message.kind === "ok"
                  ? "bg-go/10 text-go ring-go/25"
                  : "bg-danger/10 text-danger ring-danger/25",
              )}
            >
              {message.text}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ état */}
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-violet-300" />
              État du bot
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.running ? "default" : "muted"}>
                {status.running ? <PlugZap className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
                {status.running ? "Moniteur actif" : "Arrêté"}
              </Badge>
              <Badge variant={configured ? "sky" : "amber"}>
                {configured
                  ? webhook
                    ? "Mode webhook"
                    : "Mode bot"
                  : "Non configuré"}
              </Badge>
              {status.bot.connected && (
                <Badge variant="default">
                  <Check className="h-3 w-3" />
                  Gateway : {status.bot.user ?? "connecté"}
                  {status.bot.latencyMs !== null ? ` · ${status.bot.latencyMs} ms` : ""}
                </Badge>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Row label="Prochain ping">
                {status.nextRunAt ? timeUntil(status.nextRunAt) : "—"}
              </Row>
              <Row label="Dernier ping">
                {status.lastRunAt ? timeAgo(status.lastRunAt) : "—"}
              </Row>
              <Row label="Latence">
                {status.lastLatencyMs !== null ? `${status.lastLatencyMs} ms` : "—"}
              </Row>
              <Row label="Disponibilité 24 h">
                {status.uptime24h.uptimePct !== null
                  ? `${status.uptime24h.uptimePct} %`
                  : "—"}
              </Row>
              <Row label="Sondes 24 h">
                {status.uptime24h.ok}/{status.uptime24h.total}
              </Row>
              <Row label="Messages envoyés">
                {String(status.messagesSent)}
              </Row>
            </dl>

            {statusError && (
              <p
                role="status"
                className="rounded-lg bg-amber/10 p-2.5 text-xs leading-relaxed text-amber ring-1 ring-amber/30"
              >
                {statusError}
              </p>
            )}
            {status.lastError && (
              <p className="rounded-lg bg-danger/10 p-2.5 text-xs text-danger ring-1 ring-danger/25">
                {status.lastError}
              </p>
            )}
            {status.startedAt && (
              <p className="text-[11px] text-mist">
                Démarré le {formatDateTime(status.startedAt)}
              </p>
            )}

            <div className="flex flex-wrap gap-2 border-t border-edge pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void action("test", "Jeton validé.")}
                disabled={busy !== null || !configured}
              >
                {busy === "test" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Tester le jeton
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void action("send", "Message de test envoyé.")}
                disabled={busy !== null || !configured}
              >
                {busy === "send" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Message de test
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void action("ping", "Sonde effectuée.")}
                disabled={busy !== null || !configured}
              >
                {busy === "ping" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ActivityIcon className="h-3.5 w-3.5" />
                )}
                Ping maintenant
              </Button>
              <Button
                variant={status.running ? "danger" : "outline"}
                size="sm"
                onClick={() => void action(status.running ? "stop" : "start", "État mis à jour.")}
                disabled={busy !== null}
              >
                {status.running ? "Arrêter" : "Démarrer"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Mode d'emploi en 3 étapes</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 text-xs leading-relaxed text-mist">
              <li>
                <strong className="text-chalk">1.</strong> Créez une application
                sur le Portail développeurs Discord, ajoutez un <strong className="text-chalk">Bot</strong>,
                puis copiez son jeton. Aucune permission sensible n'est
                nécessaire : <code>Send Messages</code> suffit.
              </li>
              <li>
                <strong className="text-chalk">2.</strong> Invitez le bot sur
                votre serveur (OAuth2 → <code>bot</code> → scope
                <code> applications.commands</code> facultatif) et collez
                l'identifiant du canal.
              </li>
              <li>
                <strong className="text-chalk">3.</strong> Enregistrez, puis
                cliquez sur « Ping maintenant » : le message d'état arrive dans
                le canal, puis toutes les {intervalMin || 10} minutes.
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- briques */

function Field({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-mist">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl p-3 ring-1 transition-colors",
        checked ? "bg-go/5 ring-go/30" : "bg-panel2 ring-edge",
      )}
    >
      <span className="flex items-center gap-2">
        <Switch checked={checked} onChange={onChange} label={label} />
        <span className="text-xs font-medium text-chalk">{label}</span>
      </span>
      <span className="text-[11px] leading-snug text-mist">{desc}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-panel2 px-3 py-2 ring-1 ring-edge">
      <dt className="text-[10px] uppercase tracking-wide text-mist">{label}</dt>
      <dd className="text-sm text-chalk">{children}</dd>
    </div>
  );
}
