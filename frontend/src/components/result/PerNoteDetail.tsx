import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";

import type { PerNote } from "../../lib/analysis";
import { BAND_COLOR } from "../../lib/analysis";
import { cn } from "../../lib/cn";

/** Collapsible per-onset deep-dive — the underlying numbers, hidden by default. */
export function PerNoteDetail({ notes }: { notes: PerNote[] }) {
  const [open, setOpen] = useState(false);
  const timed = notes.filter((n) => !n.is_slur_interior);

  return (
    <div className="rounded-lg border border-line bg-paper-raised">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-sm font-medium text-ink">
          Every note ({timed.length})
        </span>
        <CaretDown
          size={16}
          className={cn(
            "text-ink-mute transition-transform duration-200 ease-ios",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-line px-5 py-2">
          {timed.map((n) => (
            <div
              key={n.global_index}
              className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-0"
            >
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: BAND_COLOR[n.band] }} />
                <span className="text-ink-mute">m. {n.measure_number}</span>
              </span>
              <span className="tabular-nums text-ink-soft">
                {n.delta_ms > 0 ? "+" : ""}
                {n.delta_ms} ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
