import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/** Small uppercase label above a card's content (§3.5 eyebrow). */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-deep",
        className,
      )}
    >
      {children}
    </span>
  );
}
