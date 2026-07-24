import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/** Verdict tone — these colours appear ONLY inside verdict UI. */
export type VerdictTone = "on" | "mid" | "bad";

const TONES: Record<VerdictTone, { wrap: string; dot: string }> = {
  on: { wrap: "bg-[rgba(47,110,78,0.10)] text-verdict-on", dot: "bg-verdict-on" },
  mid: { wrap: "bg-[rgba(180,122,44,0.14)] text-[#8a5c1c]", dot: "bg-verdict-mid" },
  bad: { wrap: "bg-[rgba(123,46,47,0.10)] text-verdict-bad", dot: "bg-verdict-bad" },
};

export function Badge({
  tone,
  children,
}: {
  tone: VerdictTone;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        t.wrap,
      )}
    >
      <span className={cn("size-[7px] rounded-full", t.dot)} />
      {children}
    </span>
  );
}
