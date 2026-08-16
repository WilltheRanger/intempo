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
 * The five-state verdict vocabulary, defined by the product spec in BPM terms:
 * on tempo within ±2, slight rush/drag out to ±5, rushing/dragging beyond.
 *
 * `verdictForDeviation` in `lib/tempo.ts` is the single implementation of
 * those thresholds.
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
   * Mean deviation from the target tempo, in BPM. Positive is ahead of the
   * beat. Derived from `analyses.result_json`, which the spec describes as
   * per-note deltas, verdict, and trend.
   */
  meanBpmDeviation: number;
  verdict: Verdict;
}

/**
 * What the Insights tab renders.
 *
 * Every field maps to something the backend will genuinely be able to produce:
 * counts and timestamps come from `analyses`, deviations and verdicts from
 * `analyses.result_json`, and titles from the joined `scores` row. Nothing
 * here is a metric invented to fill the screen.
 */
export interface PracticeInsights {
  /** Days the window covers. */
  windowDays: number;
  /** Completed analyses in the window, across every piece. */
  sessions: number;
  /** Mean BPM deviation across every session. Positive is ahead of the beat. */
  meanBpmDeviation: number;
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
