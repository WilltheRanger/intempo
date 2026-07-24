import type { PerMeasure } from "../../lib/analysis";
import { BAND_COLOR, measureLabel } from "../../lib/analysis";
import { Eyebrow } from "../ui/Eyebrow";

const LEGEND: Array<[string, string]> = [
  ["On tempo", BAND_COLOR.on],
  ["Slight", BAND_COLOR.slight],
  ["Off", BAND_COLOR.rush_drag],
  ["Severe", BAND_COLOR.severe],
];

/** Per-measure colour boxes — green/amber/orange/oxblood, bar number below. */
export function AnnotatedScore({ measures }: { measures: PerMeasure[] }) {
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Annotated score</Eyebrow>
      <div className="overflow-x-auto">
        <div className="flex gap-1.5 pb-1">
          {measures.map((m) => (
            <div key={m.measure_number} className="flex flex-col items-center gap-1">
              <div
                className="h-12 w-8 rounded-[5px]"
                style={{ background: BAND_COLOR[m.worst_band] }}
                title={`Measure ${m.measure_number}: ${measureLabel(m)}`}
              />
              <span className="text-[10px] tabular-nums text-ink-mute">
                {m.measure_number}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {LEGEND.map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-ink-mute">
            <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
