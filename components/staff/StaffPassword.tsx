"use client";

/**
 * Sécurité du panel : définition / changement / suppression du mot de passe,
 * et verrouillage immédiat de la session courante.
 *
 * Le mot de passe n'est jamais renvoyé par l'API : l'écran n'affiche que son
 * état (défini ou non) et la date du dernier changement.
 */
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StaffSecurityView = {
  passwordSet: boolean;
  source: "panel" | "env" | "none";
  updatedAt: string | null;
};

export function StaffPassword({ initial }: { initial: StaffSecurityView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const needsCurrent = view.passwordSet && view.source === "panel";

  async function save(password: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/staff/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        passwordSet?: boolean;
        updatedAt?: string | null;
      };
      if (!res.ok || !data.ok) {
        setFeedback({ ok: false, text: data.error ?? "Enregistrement refusé." });
        return;
      }
      setView((v) => ({
        ...v,
        passwordSet: data.passwordSet ?? Boolean(password),
        source: password ? "panel" : "none",
        updatedAt: data.updatedAt ?? null,
      }));
      setCurrent("");
      setNext("");
      setConfirm("");
      setFeedback({
        ok: true,
        text: password
          ? "Mot de passe enregistré."
          : "Mot de passe supprimé : l'allowlist STAFF_LOGINS suffit désormais.",
      });
    } catch {
      setFeedback({ ok: false, text: "Impossible de joindre le serveur." });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setFeedback({ ok: false, text: "La confirmation ne correspond pas." });
      return;
    }
    if (next.length < 8) {
      setFeedback({
        ok: false,
        text: "Le mot de passe doit contenir au moins 8 caractères.",
      });
      return;
    }
    void save(next);
  }

  async function lockNow() {
    setBusy(true);
    try {
      await fetch("/api/staff/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lock" }),
      });
      // Le claim est retiré du cookie : /staff redemande le mot de passe.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ------------------------------------------------- état + changement */}
      <section className="rounded-2xl bg-panel p-5 shadow-panel ring-1 ring-edge">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-violet-300" />
              Mot de passe du panel
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-mist">
              Second verrou, cumulatif avec l'allowlist{" "}
              <code className="text-chalk">STAFF_LOGINS</code>. Il est demandé à
              chaque nouvelle session et n'est jamais stocké en clair.
            </p>
          </div>
          <Badge variant={view.passwordSet ? "default" : "amber"}>
            {view.passwordSet ? "actif" : "inactif"}
          </Badge>
        </header>

        <dl className="mt-4 grid gap-2 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-mist">Origine</dt>
            <dd className="text-chalk">
              {view.source === "panel"
                ? "défini depuis ce panel"
                : view.source === "env"
                  ? "variable STAFF_PASSWORD"
                  : "aucun"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-mist">Dernier changement</dt>
            <dd className="text-chalk">
              {view.updatedAt
                ? new Date(view.updatedAt).toLocaleString("fr-FR")
                : "—"}
            </dd>
          </div>
        </dl>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          {needsCurrent && (
            <Field
              id="sec-current"
              label="Mot de passe actuel"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
          )}
          <Field
            id="sec-next"
            label={view.passwordSet ? "Nouveau mot de passe" : "Mot de passe"}
            value={next}
            onChange={setNext}
            autoComplete="new-password"
          />
          <Field
            id="sec-confirm"
            label="Confirmation"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />

          {feedback && (
            <p
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1",
                feedback.ok
                  ? "bg-go/10 text-go ring-go/30"
                  : "bg-danger/10 text-danger ring-danger/30",
              )}
            >
              {feedback.ok ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {feedback.text}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Enregistrer
            </Button>

            {view.passwordSet && view.source === "panel" && (
              <button
                type="button"
                disabled={busy || current.length === 0}
                onClick={() => void save("")}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  (busy || current.length === 0) && "opacity-60",
                )}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer le mot de passe
              </button>
            )}
          </div>

          <p className="text-xs leading-relaxed text-mist/80">
            8 caractères minimum. Le mot de passe est haché (scrypt, sel
            aléatoire) avant d'être écrit en base : personne ne peut le relire,
            pas même depuis ce panel.
          </p>
        </form>
      </section>

      {/* -------------------------------------------------- verrou immédiat */}
      <section className="rounded-2xl bg-panel p-5 shadow-panel ring-1 ring-edge">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4 text-violet-300" />
          Session courante
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-mist">
          Le déverrouillage est valable pour cette session uniquement (cookie
          chiffré, 7 jours maximum). Se déconnecter ou verrouiller ici remet le
          mot de passe en place — utile sur un poste partagé.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void lockNow()} disabled={busy}>
          <Lock className="h-4 w-4" />
          Verrouiller maintenant
        </Button>
        {!view.passwordSet && (
          <p className="mt-4 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber ring-1 ring-amber/30">
            Aucun mot de passe n'est défini : le verrouillage n'a aucun effet
            tant que seul <code>STAFF_LOGINS</code> protège le panel.
          </p>
        )}
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mist"
      >
        {label}
      </label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
        autoComplete={autoComplete}
      />
    </div>
  );
}
