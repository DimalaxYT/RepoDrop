import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

/** Interrupteur accessible (rôle `switch`, navigation clavier native). */
export function Switch({
  checked,
  onChange,
  label,
  className,
  disabled,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-go/60",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-go" : "bg-panel2 ring-1 ring-edge",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-[18px] w-[18px] transform rounded-full bg-ink shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-1",
        )}
      />
    </button>
  );
}
