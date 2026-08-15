import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "stop";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  fullWidth?: boolean;
  /** Renders inside the "button-in-button" trailing icon circle (primary only). */
  trailingIcon?: ReactNode;
  children: ReactNode;
};

const BASE =
  "inline-flex items-center justify-center gap-2 h-11 px-4 rounded-md font-medium text-[15px] " +
  "transition-[color,background-color,transform] duration-200 ease-ios select-none " +
  "active:scale-[0.975] disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-amber text-white shadow-[0_8px_18px_-8px_rgba(199,138,58,0.7)] hover:bg-[#A05F16]",
  ghost:
    "bg-transparent border border-line-2 text-ink hover:bg-paper-warm",
  stop: "bg-ink text-white hover:bg-black",
};

export function Button({
  variant = "primary",
  fullWidth,
  trailingIcon,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        BASE,
        VARIANTS[variant],
        fullWidth && "w-full",
        Boolean(trailingIcon) && variant === "primary" && "pr-1.5",
        className,
      )}
      {...rest}
    >
      {children}
      {trailingIcon && variant === "primary" && (
        <span className="grid size-[30px] place-items-center rounded-full bg-white/20 transition-transform duration-300 ease-ios group-hover:translate-x-0.5">
          {trailingIcon}
        </span>
      )}
    </button>
  );
}
