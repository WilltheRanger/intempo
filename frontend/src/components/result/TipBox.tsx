import { PencilSimple } from "@phosphor-icons/react";

import type { ReactNode } from "react";

/** One concrete, kind suggestion — the "next step" from a teacher. */
export function TipBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-[rgba(199,138,58,0.28)] bg-amber-soft p-3.5 shadow-hair">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-paper-raised text-amber-deep">
        <PencilSimple size={17} />
      </span>
      <p className="text-[14px] leading-relaxed text-ink">{children}</p>
    </div>
  );
}
