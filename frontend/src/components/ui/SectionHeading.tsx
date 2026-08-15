import type { ReactNode } from "react";

/**
 * Section label. Sans, sentence case, quiet. Serif is reserved for screen
 * titles and composition names, so a section heading never uses it.
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
      <h2 className="text-[14px] font-medium text-ink">
        {children}
      </h2>
      {action}
    </div>
  );
}
