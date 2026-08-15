import type { ReactNode } from "react";

/**
 * Section label. Sans, small, quiet — a wayfinding device, not a headline.
 * The serif is reserved for the things a musician actually reads: piece
 * titles and the practice prompt.
 */
export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-[12px] font-medium uppercase tracking-[0.11em] text-ink-mute">
        {children}
      </h2>
      {action}
    </div>
  );
}
