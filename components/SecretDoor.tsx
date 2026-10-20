"use client";

/**
 * Porte dérobée vers le panel staff.
 *
 * Deux façons d'entrer, aucune n'est visible à l'œil nu ni annoncée aux
 * lecteurs d'écran (`aria-hidden` + `tabIndex={-1}`) :
 *  1. le point minuscule tout à droite du pied de page (5 clics) ;
 *  2. la séquence Konami au clavier : ↑ ↑ ↓ ↓ ← → ← → B A.
 *
 * L'accès réel reste vérifié côté serveur : cette porte ne fait qu'ouvrir
 * `/staff`, qui renvoie son écran « accès restreint » à qui n'est pas staff.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

const CLICKS_NEEDED = 5;
const CLICK_WINDOW_MS = 3_000;
const KEY_WINDOW_MS = 2_500;

export function SecretDoor() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const keys = useRef<string[]>([]);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clicks = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    setUnlocked(true);
    // Navigation immédiate : aucun délai imposé (le voile se dessine pendant
    // que la page arrive).
    router.push("/staff");
  }, [router]);

  // ---------------------------------------------------------- séquence Konami
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // On ignore les frappes dans un champ (sinon un mot de passe déclenche tout).
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys.current.push(key);
      if (keys.current.length > KONAMI.length) {
        keys.current = keys.current.slice(-KONAMI.length);
      }
      if (keyTimer.current) clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(() => {
        keys.current = [];
      }, KEY_WINDOW_MS);

      const match =
        keys.current.length === KONAMI.length &&
        keys.current.every((k, i) => k === KONAMI[i]);
      if (match) {
        keys.current = [];
        open();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (keyTimer.current) clearTimeout(keyTimer.current);
    };
  }, [open]);

  // ------------------------------------------------------------- clics cachés
  const onSecretClick = (): void => {
    clicks.current += 1;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clicks.current = 0;
    }, CLICK_WINDOW_MS);
    if (clicks.current >= CLICKS_NEEDED) {
      clicks.current = 0;
      open();
    }
  };

  return (
    <>
      {/* Le « point » : quasi invisible, mais cliquable. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onSecretClick}
        title=""
        className={cn(
          "h-2 w-2 shrink-0 rounded-full bg-chalk/10 transition-opacity duration-500",
          "hover:bg-chalk/40 focus:outline-none",
          unlocked && "bg-go",
        )}
      />

      {/* Voile de déverrouillage */}
      {unlocked && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 grid place-items-center bg-ink/85 backdrop-blur-sm animate-fade-in"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/40 animate-fade-up">
              <ShieldCheck className="h-8 w-8" />
            </span>
            <p className="text-sm font-medium text-chalk">Accès staff…</p>
          </div>
        </div>
      )}
    </>
  );
}
