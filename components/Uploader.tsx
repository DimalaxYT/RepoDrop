"use client";

/**
 * Zone de dépôt d'archive : validation locale (extension / poids), upload
 * XHR avec barre de progression, puis redirection vers la page du job.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, AlertTriangle, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  maxLabel: string;
  extractLabel: string;
}

const OK_EXT = /\.(rar|zip)$/i;

export function Uploader({ maxLabel, extractLabel }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    (file: File) => {
      setError(null);
      if (!OK_EXT.test(file.name)) {
        setError("Format non supporté : seuls les fichiers .rar et .zip sont acceptés.");
        return;
      }
      if (file.size === 0) {
        setError("Ce fichier est vide.");
        return;
      }

      const form = new FormData();
      form.append("file", file, file.name);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setProgress(null);
        if (xhr.status === 202 && xhr.response?.id) {
          router.push(`/jobs/${xhr.response.id}`);
          return;
        }
        setError(
          xhr.response?.error ??
            (xhr.status === 413
              ? `Archive trop volumineuse (max ${maxLabel}).`
              : `Échec de l'envoi (HTTP ${xhr.status}). Réessayez.`),
        );
      };
      xhr.onerror = () => {
        setProgress(null);
        setError("Connexion perdue pendant l'envoi. Réessayez.");
      };
      xhr.send(form);
    },
    [maxLabel, router],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (progress !== null) return;
    const file = e.dataTransfer.files?.[0];
    if (file) send(file);
  };

  const uploading = progress !== null;

  return (
    <div className="animate-fade-up">
      <div
        role="button"
        tabIndex={0}
        aria-label="Déposer une archive .rar ou .zip"
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn(
          "relative flex min-h-72 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-all",
          "outline-none focus-visible:ring-2 focus-visible:ring-go/60",
          drag ? "border-go bg-go/5 scale-[1.01]" : "border-edge bg-panel hover:border-go/40",
          uploading && "cursor-default border-go/50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".rar,.zip,application/x-rar-compressed,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) send(f);
            e.target.value = "";
          }}
        />

        {uploading ? (
          <div className="w-full max-w-sm">
            <div className="mb-3 flex items-center justify-center gap-2 text-sm text-chalk">
              <UploadCloud className="h-5 w-5 text-go" />
              Envoi de l'archive… {progress}%
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-panel2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-go to-sky transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-mist">Ne fermez pas cet onglet.</p>
          </div>
        ) : (
          <>
            <div
              className={cn(
                "grid h-16 w-16 place-items-center rounded-2xl ring-1 transition-colors",
                drag ? "bg-go/15 text-go ring-go/40" : "bg-panel2 text-mist ring-edge",
              )}
            >
              <Archive className={cn("h-8 w-8", drag && "text-go")} />
            </div>
            <div>
              <p className="text-base font-medium text-chalk">
                Glissez votre archive ici, ou cliquez pour parcourir
              </p>
              <p className="mt-1 text-sm text-mist">
                .rar &amp; .zip — {maxLabel} max ({extractLabel} décompressés)
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-danger/10 p-3.5 text-sm text-danger ring-1 ring-danger/25 animate-fade-in"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
