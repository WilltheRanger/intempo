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
