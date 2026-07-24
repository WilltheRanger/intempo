import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Wrap in a machined "tray" (double-bezel depth) — for hero surfaces. */
  bezel?: boolean;
  children: ReactNode;
};

export function Card({ bezel, className, children, ...rest }: CardProps) {
  const card = (
    <div
      className={cn(
        "rounded-lg border border-line bg-paper-raised p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_1px_2px_rgba(74,45,12,0.05),0_10px_24px_-16px_rgba(74,45,12,0.34)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );

  if (!bezel) return card;
  return (
    <div className="rounded-xl border border-line bg-paper-deep p-1.5 shadow-hair">
      {card}
    </div>
  );
}
