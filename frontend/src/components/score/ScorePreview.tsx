import type { ScoreJson } from "../../lib/score";
import { totalNotes } from "../../lib/score";

/** Compact, read-only rendering of a parsed score (MVP list view). */
export function ScorePreview({ score }: { score: ScoreJson }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs text-ink-mute">
        <MetaChip label="Clef" value={score.clef} />
        <MetaChip label="Time" value={score.time_signature ?? "—"} />
        <MetaChip label="Key" value={score.key_signature ?? "—"} />
        <MetaChip
          label="Notes"
          value={`${totalNotes(score)} in ${score.measures.length} bars`}
        />
      </div>
      <div className="flex flex-col gap-2">
        {score.measures.map((m, i) => (
          <div
            key={i}
            className="flex gap-3 rounded-md border border-line bg-paper-warm px-3 py-2"
          >
            <span className="w-8 shrink-0 pt-0.5 text-xs font-medium text-ink-mute">
              {m.measure_number}
            </span>
            <span className="text-sm text-ink">
              {m.notes.map((n) => (n.pitch === "rest" ? "rest" : n.pitch)).join(" · ") ||
                "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-line bg-paper-raised px-2.5 py-1">
      <span className="text-ink-faint">{label} </span>
      <span className="font-medium text-ink-soft">{value}</span>
    </span>
  );
}
