"use client";

/**
 * Verrou du panel staff : écran de saisie du mot de passe.
 *
 * Affiché à un compte reconnu comme staff (`STAFF_LOGINS`) mais dont la session
 * n'a pas encore validé le mot de passe. La vérification est faite par
 * `/api/staff/unlock`, qui pose le claim `staffUnlocked` dans le cookie de
 * session chiffré — rien n'est stocké côté client.
 */
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StaffGate({ login }: { login: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/staff/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        attemptsLeft?: number;
      };
      if (!res.ok || !data.ok) {
        setError(
          data.error ?? "Mot de passe incorrect.",
        );
        setPassword("");
        setBusy(false);
        return;
      }
      // Le cookie est posé : on redemande le rendu serveur de /staff.
      router.refresh();
    } catch {
      setError("Impossible de joindre le serveur. Réessayez.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-24">
      <div className="w-full animate-fade-up rounded-2xl bg-panel p-6 text-center shadow-panel ring-1 ring-edge sm:p-8">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/30">
          <Lock className="h-6 w-6" />
        </span>

        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          Panel verrouillé
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-mist">
          Ce panel est réservé au staff. Saisissez le mot de passe pour y
          accéder.
        </p>

        <Badge variant="sky" className="mt-3">
          {login}
        </Badge>

        <form onSubmit={onSubmit} className="mt-6 space-y-3 text-left">
          <label
            htmlFor="staff-password"
            className="text-xs font-medium uppercase tracking-wider text-mist"
          >
            Mot de passe du panel
          </label>
          <Input
            id="staff-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            autoFocus
            required
            className={cn(error && "ring-danger/50")}
          />

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger ring-1 ring-danger/30">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || password.length === 0}
            className={cn(
              buttonVariants({ size: "lg" }),
              "w-full",
              (busy || password.length === 0) && "opacity-60",
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {busy ? "Vérification…" : "Déverrouiller"}
          </button>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-mist/80">
          Le mot de passe est défini depuis l'onglet Sécurité du panel, ou par
          la variable <code className="text-chalk">STAFF_PASSWORD</code>. Après
          6 essais, l'accès est suspendu 15 minutes.
        </p>
      </div>

      <Link
        href="/"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Retour à l'accueil
      </Link>
    </main>
  );
}
