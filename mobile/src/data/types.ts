/**
 * Types for the InTempo API and the models the UI renders.
 *
 * Wire types keep the backend's snake_case verbatim so a mismatch with
 * `backend/app/models/*.py` is visible rather than laundered through a rename.
 * View models are camelCase. The mapping between them lives in `data/sources`,
 * and that is the only place the two are allowed to meet.
 */

// ---------------------------------------------------------------------------
// Wire types — mirror backend/app/models/ and app/services/score_schema.py
// ---------------------------------------------------------------------------

export type UserTier = 'free' | 'pro' | 'teacher' | 'student_via_teacher';
export type UserRole = 'student' | 'teacher';

/** `metronome_mode` on `analyses`. */
export type MetronomeMode =
  | 'off'
  | 'visual'
  | 'haptic'
  | 'audio_with_headphones';

/** GET /v1/me */
export interface MeResponse {
  id: string;
  email: string;
  tier: UserTier;
  role: UserRole;
  studio_id: string | null;
}

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';

export type Articulation = 'staccato' | 'tenuto' | 'accent';

export type Dynamics =
  | 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff'
  | 'fp' | 'sfz' | 'sf' | 'fz';

export type Duration =
  | 'whole' | 'dotted_whole'
  | 'half' | 'dotted_half'
  | 'quarter' | 'dotted_quarter'
  | 'eighth' | 'dotted_eighth'
  | 'sixteenth' | 'dotted_sixteenth'
  | 'thirty_second';

export type RepeatType = 'repeat' | 'first_ending' | 'second_ending';

export interface ScoreNote {
  /** `rest`, or scientific pitch such as `D3`, `F#4`, `Bb2`. */
  pitch: string;
  duration: Duration;
  articulation?: Articulation | null;
  tied_to_next: boolean;
  dynamics?: Dynamics | null;
}

export interface ScoreSlur {
  start_note_index: number;
  end_note_index: number;
}

export interface ScoreMeasure {
  measure_number: number;
  notes: ScoreNote[];
  slurs: ScoreSlur[];
}

export interface ScoreRepeat {
  start_measure: number;
  end_measure: number;
  type: RepeatType;
}

/**
 * Parsed sheet music. `time_signature` and `key_signature` may be the literal
 * string `"unknown"` — the OCR prompt authorises that when a score's header is
 * illegible, so treat it as data rather than an error.
 */
export interface ScoreJson {
  time_signature: string | null;
  key_signature: string | null;
  tempo_marking: string | null;
  bpm_hint: number | null;
  clef: Clef;
  measures: ScoreMeasure[];
  repeats: ScoreRepeat[];
  ocr_confidence: number;
  notes_to_human: string;
}

/** GET/POST/PATCH /v1/scores */
export interface ScoreResponse {
  id: string;
  user_id: string;
  title: string;
  composer: string | null;
  source_image_url: string;
  score_json: ScoreJson;
  shared_with_studio: string | null;
  ocr_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export type AnalysisStatus =
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed'
  | 'failed_recoverable';

/**
 * GET /v1/analyses and /v1/analyses/:id.
 *
 * `result_json` is deliberately loose. Its schema lives in the pipeline
 * (`backend/app/services/classification.py`) and is still being tuned; typing
 * it here would be a second copy that goes stale silently. The adapter reads
 * the few fields it needs and tolerates the rest.
 */
export interface AnalysisResponse {
  id: string;
  user_id: string;
  score_id: string;
  status: AnalysisStatus;
  target_bpm: number;
  bpm_source: string;
  metronome_mode: MetronomeMode;
  result_json: Record<string, unknown> | null;
  failure_reason: string | null;
  alignment_quality: number | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

/** POST /v1/upload/score-image and /v1/upload/audio */
export interface UploadResponse {
  upload_url: string;
  public_url: string;
  object_key: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

/**
 * A score thumbnail: a remote URI once the backend can serve one, or the
 * module id returned by `require()` for a bundled fixture image.
 */
export type ThumbnailSource = string | number;

/**
 * What the UI renders. Deliberately not the same shape as `ScoreResponse`.
 *
 * `movement`, `progress`, `lastPracticedAt`, and `thumbnail` have no backing
 * column or endpoint today (see the Phase 1 audit). They are typed nullable so
 * every component is forced to handle their absence — which is exactly what
 * happens the moment the fixture source is swapped for the API source. Do not
 * make them non-nullable to simplify a component.
 */
export interface Piece {
  id: string;
  title: string;
  composer: string | null;
  /** e.g. "II. Adagio". No backing field. */
  movement: string | null;
  /** 0–1. No backing field. */
  progress: number | null;
  /** ISO 8601. Nearest real signal would be `analyses.created_at`. */
  lastPracticedAt: string | null;
  /** Score images live in a private bucket with no read endpoint yet. */
  thumbnail: ThumbnailSource | null;
}

/**
 * How the analysis pipeline classifies one deviation, from `result_json`.
 *
 * Bands are a percentage of one beat, with independent cutoffs for rushing
 * and dragging — humans tolerate dragging more — and the thresholds live in
 * the backend's remote config so they can be tuned without a client release.
 * That is why nothing on this side classifies: it would be a second copy of
 * numbers designed to move.
 */
export type Band = 'on' | 'slight' | 'rush_drag' | 'severe';

/**
 * Which side of the beat. Note the raw deltas in `result_json` are
 * drag-positive (`actual - expected`), while the trend and verdict flip to
 * rush-positive so "ahead" reads as a positive number. Everything in this
 * file follows the verdict convention: **positive is ahead of the beat.**
 */
export type Direction = 'rush' | 'drag' | 'on';

/**
 * The five-state vocabulary the interface shows, from the spec's design
 * section. Derived from `Band` and `Direction` by `verdictFor` in
 * `lib/tempo.ts`, which is the only place the two vocabularies meet.
 */
export type Verdict =
  | 'on_tempo'
  | 'slight_rush'
  | 'rushing'
  | 'slight_drag'
  | 'dragging';

/** One piece's practice record over the insights window. */
export interface PieceInsight {
  pieceId: string;
  title: string;
  composer: string | null;
  /** Completed analyses of this piece in the window. */
  sessions: number;
  /**
   * Mean deviation across those takes, as a percentage of one beat.
   * Positive is ahead of the beat. The same unit the pipeline classifies in,
   * so the bar and the verdict can't disagree.
   */
  meanDeviationPct: number;
  band: Band;
  direction: Direction;
  verdict: Verdict;
}

/**
 * What the Insights tab renders.
 *
 * Every field maps to something the backend produces: counts and timestamps
 * from `analyses`, deviations and bands from `analyses.result_json`, titles
 * from the joined `scores` row.
 */
export interface PracticeInsights {
  /** Days the window covers. */
  windowDays: number;
  /** Completed analyses in the window, across every piece. */
  sessions: number;
  /** Mean deviation across every session, as a percentage of one beat. */
  meanDeviationPct: number;
  band: Band;
  direction: Direction;
  verdict: Verdict;
  /** Most drift first — the pieces worth attention lead. */
  pieces: PieceInsight[];
}

/** The signed-in musician, as the UI needs them. */
export interface Musician {
  id: string;
  email: string;
  tier: UserTier;
  role: UserRole;
  studioId: string | null;
  /**
   * Profile photo. Null for most accounts, and null is the normal state — not
   * an error to design around.
   *
   * There is no avatar column on `users` and no endpoint that accepts an
   * upload, so the only photo the app can reach today is the one an OAuth
   * provider puts in the Supabase auth user's metadata. Everyone who signed up
   * with an email address has none, and falls back to a monogram.
   */
  avatarUrl: string | null;
}
