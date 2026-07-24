import type { AnalysisResult } from "../../lib/analysis";
import { Eyebrow } from "../ui/Eyebrow";

/** The headline moment — the one-line verdict, largest text on screen. */
export function VerdictCard({ result }: { result: AnalysisResult }) {
  const color =
    result.verdict_direction === "on"
      ? "var(--verdict-on)"
      : "var(--verdict-mid)";

  // Split "You rushed across measures 8–12 …" so the drift phrase can breathe.
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow>Tempo verdict</Eyebrow>
      <p
        className="font-serif text-[28px] leading-tight tracking-[-0.01em]"
        style={{ color }}
      >
        {result.verdict}
      </p>
      {result.low_confidence && (
        <p className="text-sm text-ink-mute">
          We had some trouble matching this recording — read the details with a
          grain of salt.
        </p>
      )}
    </div>
  );
}
