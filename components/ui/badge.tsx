import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1",
  {
    variants: {
      variant: {
        default: "bg-go/10 text-go ring-go/25",
        sky: "bg-sky/10 text-sky ring-sky/25",
        amber: "bg-amber/10 text-amber ring-amber/30",
        danger: "bg-danger/10 text-danger ring-danger/30",
        muted: "bg-panel2 text-mist ring-edge",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
