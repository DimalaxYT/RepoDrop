import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatte un nombre d'octets en FR (1,2 Mo). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${units[i]}`;
}

/** Formatte un nombre de fichiers en FR. */
export function formatCount(n: number): string {
  return `${n.toLocaleString("fr-FR")} fichier${n > 1 ? "s" : ""}`;
}

/** « il y a 3 min » / « hier à 14:02 » — format relatif français. */
export function timeAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < 45_000) return "à l'instant";
  if (diff < hour) {
    const n = Math.round(diff / min);
    return `il y a ${n} min`;
  }
  if (diff < day) {
    const n = Math.round(diff / hour);
    return `il y a ${n} h`;
  }
  if (diff < 2 * day) return "hier";
  if (diff < 30 * day) {
    const n = Math.round(diff / day);
    return `il y a ${n} j`;
  }
  return new Date(ts).toLocaleDateString("fr-FR");
}

/** « dans 10 min » — compte à rebours français. */
export function timeUntil(ts: number, now = Date.now()): string {
  const diff = ts - now;
  if (diff <= 0) return "maintenant";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `dans ${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `dans ${min} min`;
  const h = Math.round(min / 60);
  return `dans ${h} h`;
}

/** Horodatage complet FR : « 20 mars 2026 à 14:02:07 ». */
export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "medium",
  });
}

/** Heure seule, précise à la seconde : « 14:02:07 ». */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
