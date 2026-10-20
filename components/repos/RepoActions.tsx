"use client";

/**
 * Actions rapides sur un dépôt : renommer, changer la visibilité, éditer la
 * description, supprimer.
 *
 * Garde-fous :
 *   - les boutons sont désactivés quand le jeton n'a pas les droits
 *     (`can.push` / `can.admin`) plutôt que d'échouer côté GitHub ;
 *   - la suppression exige de retaper `owner/repo`, et le bouton reste bloqué
 *     tant que la confirmation ne correspond pas exactement ;
 *   - toute action est tracée côté serveur dans le flux d'activité du staff.
 */
import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RepoSummary } from "@/lib/repo-types";

export function RepoActions({
  repo,
  onUpdated,
  onDeleted,
}: {
  repo: RepoSummary;
  onUpdated: (next: RepoSummary) => void;
  onDeleted: (fullName: string) => void;
}) {
  const [name, setName] = useState(repo.name);
  const [description, setDescription] = useState(repo.description ?? "");
  const [busy, setBusy] = useState<"" | "patch" | "delete">("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [confirmText, setConfirmText] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  const confirmMatches = confirmText.trim() === repo.full_name;

  async function call(
    method: "PATCH" | "DELETE",
    body: unknown,
    kind: "patch" | "delete",
  ) {
    setBusy(kind);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        repo?: RepoSummary;
        deleted?: string;
        error?: string;
      };
      if (!res.ok) {
        setFeedback({ ok: false, text: data.error ?? `Échec (HTTP ${res.status}).` });
        return;
      }
      if (method === "DELETE") {
        setFeedback({ ok: true, text: `Dépôt ${data.deleted ?? repo.full_name} supprimé.` });
        onDeleted(repo.full_name);
        return;
      }
      if (data.repo) {
        onUpdated(data.repo);
        setFeedback({ ok: true, text: "Dépôt mis à jour." });
      }
    } catch {
      setFeedback({ ok: false, text: "Impossible de joindre le serveur." });
    } finally {
      setBusy("");
    }
  }

  function onSave(e: FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === repo.name) {
      // Seul le nom inchangé : on n'envoie que la description si elle a bougé.
      if (description === (repo.description ?? "")) return;
      void call("PATCH", { description }, "patch");
      return;
    }
    void call(
      "PATCH",
      { name: next, description: description === (repo.description ?? "") ? undefined : description },
      "patch",
    );
  }

  const dirty =
    name.trim() !== repo.name || description !== (repo.description ?? "");

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------- renommer / décrire */}
      <form
        onSubmit={onSave}
        className="rounded-xl bg-panel2/60 p-4 ring-1 ring-edge"
      >
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mist">
          <Pencil className="h-3.5 w-3.5" />
          Renommer / décrire
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="repo-name" className="mb-1.5 block text-xs text-mist">
              Nom du dépôt
            </label>
            <Input
              id="repo-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!repo.can.push || busy !== ""}
              spellCheck={false}
            />
            {name.trim() !== repo.name && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                Renommer casse les clones, les liens et les pages GitHub existants.
                GitHub redirige l'ancien nom, mais pas indéfiniment.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="repo-desc" className="mb-1.5 block text-xs text-mist">
              Description
            </label>
            <Input
              id="repo-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!repo.can.push || busy !== ""}
              placeholder="À quoi sert ce dépôt ?"
              maxLength={350}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!dirty || !repo.can.push || busy !== ""}>
            {busy === "patch" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Enregistrer
          </Button>
          {!repo.can.push && (
            <span className="text-[11px] text-mist">
              Droits d'écriture insuffisants sur ce dépôt.
            </span>
          )}
        </div>
      </form>

      {/* ------------------------------------------------------- visibilité */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-panel2/60 p-4 ring-1 ring-edge">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mist">
            {repo.private ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            Visibilité
          </h3>
          <p className="mt-1 text-xs text-mist">
            Actuellement{" "}
            <strong className="text-chalk">{repo.private ? "privé" : "public"}</strong>.
            {repo.private
              ? " Le rendre public expose tout l'historique des commits."
              : " Le rendre privé retire l'accès à tous les anonymes."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!repo.can.push || busy !== ""}
          onClick={() =>
            void call("PATCH", { private: !repo.private }, "patch")
          }
        >
          {repo.private ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          Rendre {repo.private ? "public" : "privé"}
        </Button>
      </div>

      {/* --------------------------------------------------------- supprimer */}
      <div
        className={cn(
          "rounded-xl p-4 ring-1 transition-colors",
          showDelete ? "bg-danger/5 ring-danger/30" : "bg-panel2/60 ring-edge",
        )}
      >
        {!showDelete ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mist">
                <Trash2 className="h-3.5 w-3.5" />
                Zone sensible
              </h3>
              <p className="mt-1 text-xs text-mist">
                La suppression est définitive : code, historique, issues et wiki.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!repo.can.admin}
              onClick={() => {
                setShowDelete(true);
                setConfirmText("");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer le dépôt
            </Button>
          </div>
        ) : (
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
              <AlertTriangle className="h-4 w-4" />
              Supprimer {repo.full_name}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-mist">
              Aucune récupération possible. Tapez{" "}
              <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-chalk ring-1 ring-edge">
                {repo.full_name}
              </code>{" "}
              pour débloquer le bouton.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={repo.full_name}
                spellCheck={false}
                autoComplete="off"
                className="max-w-xs"
                disabled={busy !== ""}
              />
              <Button
                variant="danger"
                disabled={!confirmMatches || busy !== ""}
                onClick={() => void call("DELETE", { confirm: confirmText }, "delete")}
              >
                {busy === "delete" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Supprimer définitivement
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowDelete(false);
                  setConfirmText("");
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>

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
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {feedback.text}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Badge variant={repo.private ? "muted" : "sky"}>
          {repo.private ? "privé" : "public"}
        </Badge>
        {repo.archived && <Badge variant="amber">archivé</Badge>}
        {repo.fork && <Badge variant="muted">fork</Badge>}
        {!repo.can.push && <Badge variant="amber">lecture seule</Badge>}
      </div>
    </div>
  );
}
