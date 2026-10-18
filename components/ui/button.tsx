import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-go/60 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-go text-ink hover:bg-[#4ee2ac] shadow-[0_0_24px_-8px_rgba(52,211,153,0.6)]",
        secondary: "bg-panel2 text-chalk ring-1 ring-edge hover:bg-edge/60",
        outline: "ring-1 ring-edge text-chalk hover:bg-panel2",
        ghost: "text-mist hover:text-chalk hover:bg-panel2",
        danger: "bg-danger/15 text-danger ring-1 ring-danger/30 hover:bg-danger/25",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
