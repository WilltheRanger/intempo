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

/**
 * What the musician plays.
 *
 * Local, not account data — it decides which clef the daily excerpt is written
 * in and which reference voice sounds, and neither belongs to the backend. The
 * four bowed strings only: this app measures a bow arm, and offering
 * instruments the analysis has never been tuned against would be a promise it
 * can't keep.
 */
export type Instrument = 'violin' | 'viola' | 'cello' | 'double_bass';

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
  /**
   * Where this account stands against its monthly quota.
   *
   * Null when the server couldn't count — `/v1/me` computes this best-effort
   * so a broken counter can't lock someone out on their first request. Null is
   * therefore "unknown", **not** "unlimited", and callers must not render it
   * as either.
   */
  analyses: UsageResponse | null;
}

/** Analyses used this calendar month, and what the ceiling is. */
export interface UsageResponse {
  used: number;
  /** Null for tiers with no quota — a distinct value, not a very large number. */
  limit: number | null;
  remaining: number | null;
  /** ISO 8601. The first instant of next month, when `used` returns to zero. */
  resets_at: string;
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
  | 'thirty_second'
  | 'triplet_half'
  | 'triplet_quarter'
  | 'triplet_eighth'
  | 'triplet_sixteenth';

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
  /**
   * Null until something has read the page.
   *
   * A piece created from a photograph exists before its transcription does, and
   * the clef is a fact printed on the page rather than one the app knows. A
   * guessed clef would be shown as though it had been read — a bass part
   * labelled "Treble clef" is worse than no label — so it stays absent until
   * OCR names one.
   */
  clef: Clef | null;
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
  /** e.g. "I. Adagio". Null for music with no movements. */
  movement: string | null;
  /**
   * What was uploaded — the signed *upload* URL, expired minutes later. Never
   * usable for display, which is what `image_url` is for.
   *
   * Null for a piece entered by hand, which was never photographed.
   */
  source_image_url: string | null;
  /**
   * A download URL signed when the score was read, valid for an hour. Null
   * when the object key couldn't be recovered or storage is unconfigured, so
   * every caller has to handle its absence.
   */
  image_url: string | null;
  image_url_expires_at: string | null;
  score_json: ScoreJson;
  shared_with_studio: string | null;
  ocr_confidence: number | null;
  transcription_status: TranscriptionStatus;
  /** The step the worker last reported, or null once it has finished. */
  transcription_stage: string | null;
  /** Why the reading failed, if it did. Null at every other time. */
  transcription_error: string | null;
  /** When the musician confirmed the reading is right. Null until they do. */
  transcription_accepted_at: string | null;
  /** When the photograph was deleted. Null while it is still in storage. */
  page_image_discarded_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * How far the backend has got with reading a photographed page.
 *
 * `done` for a piece entered by hand and for every score written before OCR
 * moved to a worker, so "no notes and done" means "this piece has none" rather
 * than "wait a moment" — the two look identical without this and only one of
 * them is worth waiting on.
 */
export type TranscriptionStatus = 'queued' | 'reading' | 'done' | 'failed';

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
  /** Null for takes submitted before the app started sending it. */
  instrument: Instrument | null;
  result_json: Record<string, unknown> | null;
  failure_reason: string | null;
  alignment_quality: number | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

/**
 * `result_json` when an analysis finishes. Mirrors `AnalysisResult` in
 * `backend/app/services/analysis.py`.
 *
 * **Sign convention, and it is not uniform.** `delta_pct` on a note or a
 * measure is `actual - expected`, so it is drag-positive: negative means the
 * note landed early, which is rushing. `trend` is flipped to rush-positive by
 * the pipeline so "ahead" reads as a positive number. Anything read out of
 * here is normalised to rush-positive in one place — `toTake` in
 * `data/sources/api.ts` — and nowhere else.
 */
export type ResultStatus = 'ok' | 'alignment_failed' | 'no_onsets';

export interface PerNoteResult {
  global_index: number;
  measure_number: number;
  delta_ms: number;
  /** Drag-positive. */
  delta_pct: number;
  band: Band;
  direction: Direction;
  /** Interior slur notes aren't timed individually — musicianship, not drift. */
  is_slur_interior: boolean;
}

export interface PerMeasureResult {
  measure_number: number;
  note_count: number;
  /** Drag-positive. */
  avg_delta_pct: number;
  worst_band: Band;
  direction: Direction;
}

export interface AnalysisResultJson {
  status: ResultStatus;
  quality: number;
  /** Alignment quality below the warn threshold — the screen says so. */
  low_confidence: boolean;
  /** The pipeline's own sentence, already in plain English. */
  verdict: string;
  verdict_direction: Direction;
  per_note: PerNoteResult[];
  per_measure: PerMeasureResult[];
  /** Rolling mean, rush-positive. */
  trend: number[];
  n_detected_onsets: number;
  n_expected_onsets: number;
  n_missed_notes: number;
  n_extra_notes: number;
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
 * Every field is now backed by the API — `movement` was the last one that
 * wasn't, and got a column in migration 005. They stay nullable all the same,
 * because backed is not the same as present: a piece nobody has recorded has
 * no last-practiced date, music in one movement has no movement, and a signed
 * URL can fail. Do not make any of them non-nullable to simplify a component.
 */
export interface Piece {
  id: string;
  title: string;
  composer: string | null;
  /** e.g. "II. Adagio". Null for music that has none. */
  movement: string | null;
  /** ISO 8601, from the most recent analysis. Null until one exists. */
  lastPracticedAt: string | null;
  /** A signed download URL from `/v1/scores`, or a bundled fixture image. */
  thumbnail: ThumbnailSource | null;
  /**
   * The tempo written on the score, as OCR read it. Null when the marking was
   * absent or illegible — which is common on a phone photo of a manuscript, so
   * every caller has to have an answer for its absence.
   */
  markedBpm: number | null;
  /**
   * The parsed score, for anything that needs the notes rather than the title
   * — playback, and eventually a rendered stave. Null on listings, which don't
   * fetch it, so its absence means "not loaded here", not "this piece has no
   * notes".
   */
  score: ScoreJson | null;
  /**
   * Whether the notes are still coming.
   *
   * `done` unless a scan is in flight, which is the case for every piece in
   * the library a moment after it is created. A listing reports it too, so a
   * piece still being read can say so wherever it appears.
   */
  transcriptionStatus: TranscriptionStatus;
  /** What the worker is doing right now, in words fit for a screen. */
  transcriptionStage: string | null;
  /** Why reading the page failed. Null unless `transcriptionStatus` is `failed`. */
  transcriptionError: string | null;
  /**
   * Whether the musician has confirmed this reading against the page.
   *
   * Once they have, the caveats stop asking them to — they did — and the
   * photograph is gone, so there is nothing left to check against anyway.
   */
  transcriptionAccepted: boolean;
  /**
   * Whether the photograph was discarded after acceptance.
   *
   * Distinct from simply having no image: a piece typed in by hand never had
   * one, and telling a musician their scanned piece "was entered by hand"
   * would be a small lie with no upside.
   */
  pageImageDiscarded: boolean;
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

/** One measure's timing, as the verdict screen shows it. */
export interface MeasureVerdict {
  measure: number;
  noteCount: number;
  /** Percentage of one beat, normalised to **rush-positive**: ahead is up. */
  deviationPct: number;
  band: Band;
  direction: Direction;
  verdict: Verdict;
}

/**
 * One recorded take, analysed.
 *
 * `status` is not decoration: the pipeline can finish having heard no notes,
 * or having failed to match the recording to the score. Both come back with a
 * sentence explaining it and no measures, and the screen has to say so rather
 * than render an empty chart.
 */
/**
 * Why a take produced no result at all.
 *
 * Distinct from `ResultStatus`, and the distinction matters. `ResultStatus`
 * describes what the *pipeline heard* — it ran to completion and reports that
 * it could not align, or found no onsets, and it writes a sentence saying so.
 * This describes the run itself not finishing: the audio could not be fetched,
 * the pipeline threw, or the row was swept up as stuck.
 *
 * `recoverable` is the backend's own distinction, not an invention here:
 * `analysis_runner` marks stuck rows `failed_recoverable` specifically "so the
 * client can offer a retry".
 */
export interface TakeFailure {
  recoverable: boolean;
  /**
   * The backend's `failure_reason` — a machine token like `audio_unavailable`
   * or `internal_error`, never a sentence. Not for display; the screen writes
   * its own copy from `recoverable`. Carried so a report can name it.
   */
  reason: string | null;
}

export interface TakeResult {
  id: string;
  pieceId: string;
  pieceTitle: string;
  composer: string | null;
  recordedAt: string;
  targetBpm: number;
  /**
   * Set when the run failed instead of producing a result. When this is set
   * every field below it is empty or a placeholder — there is no analysis to
   * describe — so check it before reading `status`, `headline` or `measures`.
   */
  failure: TakeFailure | null;
  status: ResultStatus;
  /** The pipeline's sentence, shown verbatim. */
  headline: string;
  direction: Direction;
  verdict: Verdict;
  /** Alignment was poor enough that the numbers deserve a caveat. */
  lowConfidence: boolean;
  measures: MeasureVerdict[];
  /** Rolling trend across the take, rush-positive. */
  trend: number[];
  missedNotes: number;
  extraNotes: number;
}

/** The signed-in musician, as the UI needs them. */
export interface Musician {
  /** Monthly analysis quota, or null when the server didn't report it. */
  usage: UsageResponse | null;
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
