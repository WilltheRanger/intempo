/** TypeScript mirror of the backend AnalysisResult (services/analysis.py). */

export type Band = "on" | "slight" | "rush_drag" | "severe";
export type Direction = "rush" | "drag" | "on";
export type PipelineStatus = "ok" | "alignment_failed" | "no_onsets";
export type RowStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "failed_recoverable";

export type PerNote = {
  global_index: number;
  measure_number: number;
  delta_ms: number;
  delta_pct: number;
  band: Band;
  direction: Direction;
  is_slur_interior: boolean;
};

export type PerMeasure = {
  measure_number: number;
  note_count: number;
  avg_delta_pct: number;
  worst_band: Band;
  direction: Direction;
};

export type AnalysisResult = {
  status: PipelineStatus;
  quality: number;
  low_confidence: boolean;
  verdict: string;
  verdict_direction: Direction;
  per_note: PerNote[];
  per_measure: PerMeasure[];
  trend: number[];
  n_detected_onsets: number;
  n_expected_onsets: number;
  n_missed_notes: number;
  n_extra_notes: number;
};

/** The row returned by GET /v1/analyses/:id. */
export type AnalysisRow = {
  id: string;
  user_id: string;
  score_id: string;
  status: RowStatus;
  target_bpm: number;
  bpm_source: string;
  metronome_mode: string;
  result_json: AnalysisResult | null;
  failure_reason: string | null;
  alignment_quality: number | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

/** Band → the manuscript verdict hues (green / amber / orange / oxblood). */
export const BAND_COLOR: Record<Band, string> = {
  on: "#2F6E4E",
  slight: "#B47A2C",
  rush_drag: "#C56A2C",
  severe: "#7B2E2F",
};

export function directionWord(direction: Direction): string {
  if (direction === "rush") return "Rushing";
  if (direction === "drag") return "Dragging";
  return "On tempo";
}

/** A short measure label combining band + direction. */
export function measureLabel(m: PerMeasure): string {
  if (m.worst_band === "on") return "On tempo";
  const dir = m.direction === "rush" ? "rush" : "drag";
  if (m.worst_band === "slight") return `Slight ${dir}`;
  if (m.worst_band === "severe") return `Severe ${dir}`;
  return dir === "rush" ? "Rushing" : "Dragging";
}

export const TERMINAL_STATUSES: RowStatus[] = [
  "done",
  "failed",
  "failed_recoverable",
];

const SEVERITY: Record<Band, number> = { on: 0, slight: 1, rush_drag: 2, severe: 3 };

type Run = { start: number; end: number; dir: Direction; band: Band };

/** Contiguous runs of off-tempo measures sharing a direction. */
function offRuns(per: PerMeasure[]): Run[] {
  const sorted = [...per].sort((a, b) => a.measure_number - b.measure_number);
  const out: Run[] = [];
  for (const m of sorted) {
    if (m.worst_band === "on") continue;
    const last = out[out.length - 1];
    if (last && last.dir === m.direction && m.measure_number === last.end + 1) {
      last.end = m.measure_number;
      if (SEVERITY[m.worst_band] > SEVERITY[last.band]) last.band = m.worst_band;
    } else {
      out.push({ start: m.measure_number, end: m.measure_number, dir: m.direction, band: m.worst_band });
    }
  }
  return out;
}

/** The two-tone headline: an amber phrase + a graphite location (moodboard). */
export function verdictHeadline(r: AnalysisResult): { phrase: string; location: string } {
  const runs = offRuns(r.per_measure);
  if (runs.length === 0) {
    return { phrase: "On tempo", location: "the whole way through." };
  }
  const run = runs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  const dir = run.dir === "rush" ? "rush" : "drag";
  const word =
    run.band === "slight"
      ? `Slight ${dir},`
      : run.band === "severe"
        ? `${dir === "rush" ? "Really rushing" : "Really dragging"},`
        : `${dir === "rush" ? "Rushing" : "Dragging"},`;
  const location =
    run.start === run.end
      ? `measure ${run.start}.`
      : `measures ${run.start} through ${run.end}.`;
  return { phrase: word.charAt(0).toUpperCase() + word.slice(1), location };
}

function ranges(nums: number[]): string {
  const s = [...nums].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = s[0];
  let prev = s[0];
  for (let i = 1; i <= s.length; i++) {
    if (i < s.length && s[i] === prev + 1) {
      prev = s[i];
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = s[i];
    prev = s[i];
  }
  return parts.join(", ");
}

function pct(v: number): string {
  const r = Math.round(v);
  return `${r > 0 ? "+" : r < 0 ? "-" : ""}${Math.abs(r)}%`;
}

/** The three stat chips (Tempo range / Steadiest / Longest drift). */
export function deriveStats(r: AnalysisResult): {
  range: string;
  steadiest: string;
  longest: string;
} {
  const trend = r.trend.length ? r.trend : [0];
  const lo = Math.min(...trend);
  const hi = Math.max(...trend);
  const steady = r.per_measure.filter((m) => m.worst_band === "on").map((m) => m.measure_number);
  const runs = offRuns(r.per_measure);
  const longestRun = runs.reduce(
    (a, b) => (b.end - b.start > a.end - a.start ? b : a),
    { start: 0, end: -1, dir: "on" as Direction, band: "on" as Band },
  );
  const runLen = longestRun.end - longestRun.start + 1;
  return {
    range: `${pct(lo)} to ${pct(hi)}`,
    steadiest: steady.length ? `m. ${ranges(steady)}` : "none yet",
    longest: runLen > 0 ? `${runLen} bar${runLen === 1 ? "" : "s"}` : "none",
  };
}
