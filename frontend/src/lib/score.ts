/** TypeScript mirror of the backend `ScoreJson` (spec §6 / score_schema.py). */

export type Clef = "treble" | "bass" | "alto" | "tenor";

export type Duration =
  | "whole"
  | "dotted_whole"
  | "half"
  | "dotted_half"
  | "quarter"
  | "dotted_quarter"
  | "eighth"
  | "dotted_eighth"
  | "sixteenth"
  | "dotted_sixteenth"
  | "thirty_second";

export type Note = {
  pitch: string; // "rest" or scientific pitch like "D3", "F#4", "Bb2"
  duration: Duration;
  articulation?: string | null;
  tied_to_next?: boolean;
  dynamics?: string | null;
};

export type Slur = { start_note_index: number; end_note_index: number };

export type Measure = {
  measure_number: number;
  notes: Note[];
  slurs?: Slur[];
};

export type ScoreJson = {
  time_signature?: string | null;
  key_signature?: string | null;
  tempo_marking?: string | null;
  bpm_hint?: number | null;
  clef: Clef;
  measures: Measure[];
  repeats?: unknown[];
  ocr_confidence: number;
  notes_to_human?: string;
};

export type ScoreResponse = {
  id: string;
  user_id: string;
  title: string;
  composer?: string | null;
  source_image_url: string;
  score_json: ScoreJson;
  ocr_confidence?: number | null;
  created_at: string;
  updated_at: string;
};

export const DURATIONS: Duration[] = [
  "whole",
  "dotted_whole",
  "half",
  "dotted_half",
  "quarter",
  "dotted_quarter",
  "eighth",
  "dotted_eighth",
  "sixteenth",
  "dotted_sixteenth",
  "thirty_second",
];

export const DURATION_LABEL: Record<Duration, string> = {
  whole: "Whole",
  dotted_whole: "Dotted whole",
  half: "Half",
  dotted_half: "Dotted half",
  quarter: "Quarter",
  dotted_quarter: "Dotted quarter",
  eighth: "Eighth",
  dotted_eighth: "Dotted eighth",
  sixteenth: "Sixteenth",
  dotted_sixteenth: "Dotted sixteenth",
  thirty_second: "Thirty-second",
};

/** Short chip label, e.g. "♩" isn't reliable cross-font, so use words. */
export const DURATION_SHORT: Record<Duration, string> = {
  whole: "whole",
  dotted_whole: "whole·",
  half: "half",
  dotted_half: "half·",
  quarter: "1/4",
  dotted_quarter: "1/4·",
  eighth: "1/8",
  dotted_eighth: "1/8·",
  sixteenth: "1/16",
  dotted_sixteenth: "1/16·",
  thirty_second: "1/32",
};

const PITCH_RE = /^(rest|[A-G](#|b)?-?\d)$/;

export function isValidPitch(pitch: string): boolean {
  return PITCH_RE.test(pitch.trim());
}

export const CONFIDENCE_THRESHOLD = 0.7;

export function totalNotes(score: ScoreJson): number {
  return score.measures.reduce((sum, m) => sum + m.notes.length, 0);
}
