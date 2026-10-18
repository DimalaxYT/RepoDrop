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
