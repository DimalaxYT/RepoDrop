import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Petit spinner aligné avec le texte. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden="true" />;
}

/** Barre de progression indéterminée animée. */
export function IndeterminateBar({ className }: { className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-panel2", className)}>
      <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-go to-sky animate-indeterminate" />
    </div>
  );
}
