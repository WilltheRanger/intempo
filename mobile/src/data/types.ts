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
  /**
   * What they play, or **null because nobody has asked yet**.
   *
   * Never defaulted on the wire. `violin` here has to mean a person chose
   * violin — the same rule `ScoreJson.clef` follows, and for the same reason:
   * an assumed value indistinguishable from a stated one is worse than an
   * absent one. The onboarding screen has nothing to key off otherwise.
   */
  instrument: Instrument | null;
  /** What to call them. Null is a legitimate final answer for someone who skipped. */
  display_name: string | null;
  /** A freshly signed URL, or null. The server stores a key, never a URL. */
  avatar_url: string | null;
  /**
   * When onboarding was completed **or skipped**. Null means the screen has
   * not been shown, and that is the only thing that decides whether to show it.
   */
  onboarded_at: string | null;
  /**
   * Whether their corrections to a reading may be kept to improve it, and the
   * photograph kept alongside them.
   *
   * A boolean, though the column is a timestamp: *when* they agreed is a fact
   * the consent record needs and a screen has no use for. Defaults false and
   * a server without migration 013 returns false, which is correct — a
   * deployment that cannot store consent has not got any.
   *
   */
  training_consent: boolean;
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

/**
 * Why a note's deviation was not measured against a time the page states.
 *
 * Mirrors `classification.UntimedReason`. A closed set rather than a sentence,
 * so the words a musician reads are written here, in the app, next to the rest
 * of its copy — and the pipeline only says which case it is.
 */
export type UntimedReason = 'tempo_change' | 'fermata' | 'ornament';

/**
 * What a musician can say actually happened in a bar the app judged.
 *
 * Mirrors `routers/corrections.UserVerdict`, held by
 * `test_client_enums.py` — a closed set crossing the wire inside a request
 * body, which is the same thing `Duration` and `Clef` are and gets the same
 * treatment.
 *
 * Three words and not four bands: someone disagreeing with a bar is not
 * adjudicating between "slight rush" and "rushing". `unsure` is a real answer
 * rather than a refusal to answer — the spec expects many corrections from
 * people disagreeing with the concept, and someone who cannot remember is
 * more useful in the data than someone who guessed.
 */
export type UserVerdict = 'on_tempo' | 'rushing' | 'dragging' | 'unsure';

/** One bar's worth of "this is what actually happened", as the API takes it. */
export interface CorrectionInput {
  measure_number: number;
  /** What the app said, so the pair is stored together. */
  app_verdict: string;
  user_verdict: UserVerdict;
  comment?: string | null;
}

export type Hairpin = 'crescendo' | 'diminuendo';

export type Dynamics =
  | 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff'
  | 'fp' | 'sfz' | 'sf' | 'fz';

/**
 * Every note value the server can name.
 *
 * **Generated from `DURATION_BEATS` in `backend/app/services/score_schema.py`**
 * and held to it by `test_client_enums.py`, which compares the two as sets. A
 * name only the server has means the app cannot read a score it is sent; a name
 * only the app has means a control offering a value nothing will ever produce.
 *
 * The guarantee, which is what makes this a list rather than a patchwork:
 * **every written value from a breve to a 128th has a name — plain, and as a
 * triplet, quintuplet or septuplet.** Dotted values inside tuplets, nonuplets,
 * and anything finer than a 128th do not, and `tools/notation-coverage.py`
 * prints exactly which on every run.
 */
export type Duration =
  | 'double_whole'
  | 'dotted_whole'
  | 'whole'
  | 'double_dotted_half'
  | 'dotted_half'
  | 'half'
  | 'double_dotted_quarter'
  | 'dotted_quarter'
  | 'quarter'
  | 'double_dotted_eighth'
  | 'dotted_eighth'
  | 'eighth'
  | 'dotted_sixteenth'
  | 'sixteenth'
  | 'dotted_thirty_second'
  | 'thirty_second'
  | 'dotted_sixty_fourth'
  | 'sixty_fourth'
  | 'one_twenty_eighth'
  | 'triplet_breve'
  | 'triplet_whole'
  | 'triplet_half'
  | 'triplet_quarter'
  | 'triplet_eighth'
  | 'triplet_sixteenth'
  | 'triplet_thirty_second'
  | 'triplet_sixty_fourth'
  | 'triplet_one_twenty_eighth'
  | 'quintuplet_breve'
  | 'quintuplet_whole'
  | 'quintuplet_half'
  | 'quintuplet_quarter'
  | 'quintuplet_eighth'
  | 'quintuplet_sixteenth'
  | 'quintuplet_thirty_second'
  | 'quintuplet_sixty_fourth'
  | 'quintuplet_one_twenty_eighth'
  | 'septuplet_breve'
  | 'septuplet_whole'
  | 'septuplet_half'
  | 'septuplet_quarter'
  | 'septuplet_eighth'
  | 'septuplet_sixteenth'
  | 'septuplet_thirty_second'
  | 'septuplet_sixty_fourth'
  | 'septuplet_one_twenty_eighth';

/** The note value counted by the metronome number printed on the page. */
export type TempoBeatUnit = Duration;

export type RepeatType = 'repeat' | 'first_ending' | 'second_ending';

export interface ScoreNote {
  /** `rest`, or scientific pitch such as `D3`, `F#4`, `Bb2`. */
  pitch: string;
  duration: Duration;
  articulation?: Articulation | null;
  tied_to_next: boolean;
  dynamics?: Dynamics | null;
  /**
   * The other noteheads struck together with this one — a double stop, a chord.
   *
   * Additive, and deliberately outside the timeline: `pitch` is still the one
   * pitch and `duration` still governs when the next note starts, because a
   * chord is one attack. What this carries is the part the reading used to
   * drop, so a stave can draw both noteheads instead of one.
   *
   * Absent on every score written before it was recorded. The stave draws
   * each member as a notehead on the principal's stem (`StaveNote.chord`), and
   * Listen sounds them at the principal's onset.
   */
  chord_pitches?: string[];
  /** The printed duration is intentionally held beyond its written value. */
  fermata?: boolean;
  /** Audible grace-note attacks immediately before this main note. */
  grace_notes?: number;
  /**
   * The grace notes' pitches, in the order they are played. Listen plays an
   * ornament only when it has every one: a count alone stays silent, because
   * an invented note is worse than a missing one.
   */
  grace_pitches?: string[];
  /**
   * A crescendo or diminuendo begins here — a hairpin, or the word. Playback
   * only: Listen moves the level from this note to the next one written
   * (`expression.levelsAlong`). Nothing in the timing reads it.
   */
  hairpin?: Hairpin | null;
  /** The hairpin running into this note ends on it. */
  hairpin_end?: boolean;
}

export interface ScoreSlur {
  start_note_index: number;
  end_note_index: number;
}

/**
 * A bracketed group and the ratio printed over it.
 *
 * `actual_notes` in the time of `normal_notes` — MusicXML's own vocabulary, so
 * a scanned page and an imported file describe a tuplet the same way. It is a
 * check rather than a source of durations: the beats come from `duration`, and
 * the ratio is what catches the misread the beat sum cannot see, since three
 * triplet eighths written for a bracketed 5 sum to exactly the right number.
 */
export interface ScoreTuplet {
  start_note_index: number;
  end_note_index: number;
  actual_notes: number;
  normal_notes: number;
}

/**
 * A measure the reading cannot vouch for, as the server found it.
 *
 * Sent rather than recomputed. The app has its own beat-sum check, which was
 * enough while beat sums were the only test; the server also checks broken
 * ties, tuplet ratios, note density, notes this schema cannot write, and bars
 * wildly out of step with a page whose metre could not be read — and **every
 * one of those can fire on a measure whose beats add up exactly**. Recomputing
 * them here would be a fourth copy of a validator that has already drifted
 * three times (`ocr/validate.py` and its two browser ports).
 */
export interface MeasureConcern {
  measure_number: number;
  /**
   * `unwritable` is the odd one out: it is not a doubt about the reading. The
   * page was read correctly and this app has no name for what was on it — a
   * double accidental, a triple dot, a quintuplet — so the notes are dropped
   * rather than mis-named.
   *
   * `adrift` is a bar far out of step with the rest of a page whose **metre
   * could not be read**, so it is measured against the other bars instead.
   *
   * The app names exactly one of these: `'beats'`, the only wording allowed to
   * promise arithmetic. Every other kind has its `detail` shown verbatim,
   * which is what lets a new server-side check reach the screen with no client
   * change — `test_a_new_concern_kind_would_still_reach_the_musician` pins
   * that, so do not add a second branch here.
   */
  kind: 'beats' | 'tie' | 'tuplet' | 'density' | 'unwritable' | 'adrift';
  /** A sentence fit to show a musician. */
  detail: string;
}

export interface ScoreMeasure {
  measure_number: number;
  notes: ScoreNote[];
  slurs: ScoreSlur[];
  /** Absent on scores written before brackets were recorded. */
  tuplets?: ScoreTuplet[];
  /**
   * The meter, when it **changes** at this measure. Absent everywhere else,
   * and absent on every score written before it was recorded.
   *
   * The one field on a measure that is not about the notes in it. Anything
   * rebuilding a measure has to carry it — a bar edited without it loses the
   * change, and then every bar after it reads as having the wrong number of
   * beats, because the meter it set was running for all of them. Spreading the
   * measure, as `MeasureEditScreen` does, is enough.
   */
  time_signature?: string | null;
  /**
   * The clef, when it **changes** at this measure. Absent everywhere else, and
   * absent on every score written before it was recorded.
   *
   * The same shape as `time_signature` above and carrying the same obligation:
   * anything rebuilding a measure has to preserve it, or the change is lost and
   * every bar after it is captioned — and drawn — in a clef the page stopped
   * using. A cello or bass part moving into tenor for a high passage is
   * ordinary writing, not an edge case.
   *
   * `ScoreScore.clef` stays the clef the page **opens** in, which is what a
   * reader wants when nothing says otherwise.
   */
  clef?: Clef | null;
  /**
   * The key, when it **changes** at this measure. Absent everywhere else, and
   * absent on every score written before it was recorded.
   *
   * The third field of this shape and the same obligation: a bar rebuilt
   * without it loses the change, and every bar after it is engraved in a key
   * the page stopped using — two flats on every system of a passage the page
   * put in G, and an inline sharp on every F. The name as printed, the same
   * grammar as `ScoreJson.key_signature`, which stays the key the page opens
   * in.
   */
  key_signature?: string | null;
  /**
   * How many notes the reading saw in this bar and could not write.
   *
   * Absent on every score written before it was recorded, and 0 on a clean
   * bar. Carried, not computed — the server turns it into a concern. Clearing
   * it is the server's job too: a bar whose notes come back rewritten has been
   * repaired, and keeping the count would leave a caveat nobody can dismiss.
   */
  unwritable_notes?: number;
}

/**
 * A marking that says the tempo itself changes: rit., accel., a tempo.
 *
 * Not `tempo_marking`, which is what the piece is headed with. This is what
 * makes a *correct* performance stop matching a steady beat — and until it was
 * recorded, a musician who slowed exactly as marked was told they dragged.
 *
 * The extent is not stated and is not missing: a rit. carries no amount and
 * usually no printed end, so the server derives where it stops from the next
 * marking.
 */
export interface ScoreTempoChange {
  measure_number: number;
  kind: 'ritardando' | 'accelerando' | 'a_tempo';
  /** What is printed — "rit.", "poco rall.". Quoted, never paraphrased. */
  text: string;
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
  /** Absent on scores saved before printed tempo units were preserved. */
  tempo_beat_unit?: TempoBeatUnit | null;
  /** Quarter notes per minute, regardless of the printed beat unit. */
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
  /** Absent on scores written before tempo markings were recorded. */
  tempo_changes?: ScoreTempoChange[];
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
  /**
   * Every page of the scan, signed and in page order — page one first, so it
   * is the same URL `image_url` carries.
   *
   * Sent only by `GET /v1/scores/:id`. The library listing leaves it as one
   * entry, because a grid of thumbnails draws page one and forty rows of four
   * pages is payload nothing renders. Optional so an older backend, which
   * omits it entirely, still parses.
   */
  image_urls?: string[];
  image_url_expires_at: string | null;
  /**
   * The notation. **Null when the listing was asked for without it** —
   * `listScores({ includeScore: false })` — and for a piece whose reading has
   * not produced anything. `transcription_status` is what says whether notation
   * is coming; `getScore` is the authority on what it is.
   */
  score_json: ScoreJson | null;
  /** Measures the server could not vouch for. Absent on an older backend. */
  concerns?: MeasureConcern[];
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
  /**
   * Which leg of the pipeline an in-flight run has reached, or null.
   *
   * Advisory: `status` remains the authority on whether an analysis is
   * finished. Null on a row the runner has not picked up, on a finished row,
   * and on a deployment whose table predates migration 025 — all of which
   * `progressFor` reads as "no finer information" rather than as no progress.
   */
  stage: string | null;
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
export type ResultStatus = 'ok' | 'alignment_failed' | 'no_onsets' | 'not_played';

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
  /**
   * A written tempo change covers this note's measure, so `band` and
   * `direction` are `on` by *refusal* rather than by measurement: the bands
   * measure distance from a steady beat and the page has said the beat is not
   * steady there.
   */
  under_tempo_change?: boolean;
  /** The change lurched at this note instead of flowing. */
  uneven?: boolean;
}

export interface PerMeasureResult {
  measure_number: number;
  note_count: number;
  /** Drag-positive, over the notes that were **timed**. */
  avg_delta_pct: number;
  /**
   * How many of `note_count` were measured against a time the page states.
   *
   * Absent on a result stored before the field existed — read as "all of
   * them", which is what those rows meant. Zero means nothing in the bar was
   * timed and `avg_delta_pct` fell back to the whole bar, so it must not be
   * read as a verdict.
   */
  timed_note_count?: number | null;
  /**
   * Why nothing in the bar was timed, when every untimed note agrees.
   *
   * Absent on an older result, and absent when the bar's untimed notes give
   * different reasons — `_shared_untimed_reason` refuses to pick one, since a
   * caption on the whole row has to explain the whole row.
   */
  untimed_reason?: UntimedReason | null;
  worst_band: Band;
  direction: Direction;
  /**
   * A written tempo change covers this measure. Nothing renders this yet, and
   * when something does: a rushing or dragging colour here would be colouring
   * a bar the page said would not be steady.
   */
  under_tempo_change?: boolean;
  /** Somewhere in this measure the change lurched rather than flowed. */
  uneven?: boolean;
  /**
   * The tempo this bar was played at, in BPM (`insights.tempo_by_bar`) — what
   * the verdict's charts plot. Absent on a result stored before 2026-09-25,
   * and null for a bar with too few paired notes to time.
   */
  played_bpm?: number | null;
  /**
   * How far this bar's notes sat from the player's own tuning, in cents,
   * sharp-positive (`services/intonation.py`). Absent on results stored
   * before 2026-09-25; null where nothing in the bar could be read.
   */
  pitch_cents?: number | null;
}

/**
 * How in tune a take was, as the pipeline stores it. The thresholds travel
 * with the take, as `Tolerance` does.
 */
export interface IntonationSummaryJson {
  tuning_cents: number;
  spread_cents: number;
  notes: number;
  in_tune_cents: number;
  slight_cents: number;
  tuning_worth_saying_cents: number;
}

/**
 * The band edges a take was judged by, as a percentage of one beat.
 *
 * Sent with the result rather than fetched from config, because these are
 * tunable server-side and a take was judged by whichever values were in force
 * when it ran. Reading today's numbers would silently rescale every take
 * already stored.
 *
 * Null on analyses finished before the pipeline recorded them. `lib/tempo.ts`
 * owns the fallback; nothing else should hard-code these.
 */
export interface Tolerance {
  rushing_inner_pct: number;
  rushing_mid_pct: number;
  rushing_outer_pct: number;
  dragging_inner_pct: number;
  dragging_mid_pct: number;
  dragging_outer_pct: number;
}

export interface AnalysisResultJson {
  comparison_key?: string | null;
  status: ResultStatus;
  quality: number;
  /** Alignment quality below the warn threshold — the screen says so. */
  low_confidence: boolean;
  /** The pipeline's own sentence, already in plain English. */
  verdict: string;
  verdict_direction: Direction;
  /** Null on takes analysed before the pipeline recorded them. */
  tolerance: Tolerance | null;
  per_note: PerNoteResult[];
  per_measure: PerMeasureResult[];
  /** Rolling mean, rush-positive. */
  trend: number[];
  n_detected_onsets: number;
  n_expected_onsets: number;
  n_missed_notes: number;
  n_extra_notes: number;
  /**
   * What the pipeline knows beyond the verdict — the pace actually played,
   * whether it held, how evenly, and the take split by written note value.
   *
   * Optional because a take analysed before the pipeline computed any of it
   * has none, and every field inside is independently nullable: a short take
   * has a pace and a spread but no trustworthy drift.
   */
  insights?: AnalysisInsights | null;
  /** How in tune the take was. Absent on older results; null with too few notes. */
  intonation?: IntonationSummaryJson | null;
}

/** One written note value, and how it was timed across the take. */
export interface NoteValueTiming {
  beats: number;
  /** What a musician calls it, or null for a length with no plain name. */
  label: string | null;
  note_count: number;
  /** Mean delta for this value, in percent of a beat. Negative is early. */
  mean_delta_pct: number;
}

/**
 * The single most unusual thing about a take, already a finished sentence.
 *
 * Ranked server-side across every candidate rather than chosen by a fixed
 * priority, so a take whose real story is the sixteenths does not lead with a
 * 2 BPM tempo difference nobody would notice.
 */
export interface TakeFinding {
  kind: 'tempo' | 'drift' | 'note_value' | 'steadiness';
  text: string;
  /** How many times its own "worth saying" threshold this cleared. */
  weight: number;
}

export interface AnalysisInsights {
  played_bpm: number | null;
  tempo_difference_bpm: number | null;
  drift_bpm: number | null;
  steadiness_pct: number | null;
  by_note_value: NoteValueTiming[];
  standout_value: NoteValueTiming | null;
  /** Null when nothing clears its threshold, which is the common case. */
  lead: TakeFinding | null;
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
export type ThumbnailSource =
  | string
  | number
  /**
   * A signed URL pinned to a stable cache key — the storage path, which
   * survives the token rotating. See `lib/imageSource.stableImage` for why a
   * raw signed URL re-downloads on every rotation.
   */
  | { uri: string; cacheKey: string };

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
   * Every photographed page of this piece, in page order.
   *
   * **`thumbnail` is page one, and for a long time it was the only one there
   * was.** The piece screen's row says *"The pages this piece was read from"*
   * and drew a single image, so a musician who photographed a four-page part
   * could not look at the bar flagged on page three.
   *
   * Populated only when reading **one** piece — the library listing signs page
   * one alone, because forty rows of four pages is a payload the grid does not
   * draw. Empty for a piece entered by hand, and for one whose photographs
   * were discarded on acceptance.
   */
  pages: ThumbnailSource[];
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
   * Measures the server could not vouch for, and why.
   *
   * Empty for a clean page and for a piece with nothing read yet. Absent when
   * the backend predates the field, which is what makes the local beat-sum
   * check still worth keeping as a fallback.
   */
  concerns?: MeasureConcern[];
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
  /** How far off the beat, either way — see `PracticeInsights.spreadPct`. */
  spreadPct: number;
  band: Band;
  direction: Direction;
  verdict: Verdict;
  /** The thresholds behind `band` — see `PracticeInsights.tolerance`. */
  tolerance: Tolerance | null;
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
  /**
   * Mean **distance** from the beat, ignoring which side — the same unit.
   *
   * The companion `meanDeviationPct` needs and never had. That one is a signed
   * mean, so a musician who is 18% ahead in one bar and 18% behind in the next
   * averages to zero and reads as perfectly steady. This one reads 18, which is
   * the number that describes the playing.
   *
   * Never smaller than `Math.abs(meanDeviationPct)`, since the mean of the
   * absolute values is at least the absolute value of the mean — so the gap
   * between them is exactly the part of the wandering that a direction cannot
   * explain.
   */
  spreadPct: number;
  band: Band;
  direction: Direction;
  verdict: Verdict;
  /**
   * The thresholds behind `band`, taken from the same take. A window can span
   * a retune, so there is no single set covering all of it — the take that set
   * the band is the one whose scale belongs with it.
   */
  tolerance: Tolerance | null;
  /** Most drift first — the pieces worth attention lead. */
  pieces: PieceInsight[];
}

/** One measure's timing, as the verdict screen shows it. */
export interface MeasureVerdict {
  measure: number;
  /**
   * The tempo this bar was played at, in BPM, or null — an older result, or a
   * bar with too few notes to time. See `lib/verdict/barTempo.ts`.
   */
  playedBpm: number | null;
  /**
   * How far the bar's notes sat from the player's tuning, in cents,
   * sharp-positive, or null. See `lib/verdict/intonation.ts`.
   */
  pitchCents: number | null;
  noteCount: number;
  /** Percentage of one beat, normalised to **rush-positive**: ahead is up. */
  deviationPct: number;
  band: Band;
  direction: Direction;
  verdict: Verdict;
  /**
   * A written tempo change covers this measure, so it was **not timed**.
   *
   * The pipeline forces `band` to `on` here by refusal — the page has said the
   * beat will not be steady, so the tolerance bands measure nothing — while
   * still reporting the real `deviationPct`. Carrying only those two would put
   * a large deviation next to the word for no deviation. `readMeasure` is the
   * one place that decides what a row like this says.
   */
  underTempoChange: boolean;
  /**
   * The change lurched somewhere in this measure instead of flowing.
   *
   * The only thing worth saying about a bar the bands refused, and the pipeline
   * already computes it: `uneven_measures` reads 9 ms for an even slowing and
   * 44 for a lurch.
   */
  uneven: boolean;
  /**
   * How many notes in the bar were measured against a time the page states.
   *
   * Null on a take analysed before the pipeline reported it — read as "all of
   * them". Zero means the bar was not timed at all, which a `rit.` is only one
   * cause of: a fermata says one length is not written down, and an ornament
   * and the note it decorates are placed by a number the pipeline invented.
   */
  timedNoteCount: number | null;
  /**
   * Why nothing in the bar was timed, when every untimed note agrees.
   *
   * **`timedNoteCount: 0` said the app could not judge the bar; this says who
   * decided that.** Two of the three are the page speaking — a fermata hands
   * one length to the player, a tempo change withdraws the steady beat — and
   * only `ornament` is a limitation of the pipeline, which places a grace note
   * and the note it decorates by a number it invented. Reporting all three as
   * "Not timed" made the page's own instructions look like the app failing.
   *
   * Null for an older take, and also for a bar whose untimed notes disagree.
   * Both mean "no single reason", which is one sentence, so they share a value.
   */
  untimedReason: UntimedReason | null;
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
  comparisonKey?: string | null;
  id: string;
  /** True when this take came from private storage and can be heard again. */
  recordingAvailable?: boolean;
  pieceId: string;
  pieceTitle: string;
  composer: string | null;
  recordedAt: string;
  /** Internal quarter-note rate used by the timing engine. */
  targetBpm: number;
  /** The note value that number is shown in; absent on older scores. */
  tempoBeatUnit?: TempoBeatUnit | null;
  /**
   * Set when the run failed instead of producing a result. When this is set
   * every field below it is empty or a placeholder — there is no analysis to
   * describe — so check it before reading `status`, `headline` or `measures`.
   */
  failure: TakeFailure | null;
  status: ResultStatus;
  /** The pipeline's sentence, shown verbatim. */
  headline: string;
  /**
   * One line under the headline, or null on the takes where there is nothing
   * worth adding — which is most of them, deliberately. A screen that always
   * has a second sentence teaches a musician that the second sentence is
   * furniture, and then the one that matters is not read either.
   */
  finding: TakeFinding | null;
  direction: Direction;
  verdict: Verdict;
  /** Alignment was poor enough that the numbers deserve a caveat. */
  lowConfidence: boolean;
  measures: MeasureVerdict[];
  /** Rolling trend across the take, rush-positive. */
  trend: number[];
  /** What this take was judged by. Null on older analyses. */
  tolerance: Tolerance | null;
  /** How in tune it was, or null — an older result, or too few notes read. */
  intonation: TakeIntonation | null;
  missedNotes: number;
  extraNotes: number;
}

/** How in tune a take was, against the player's own tuning, in cents. */
export interface TakeIntonation {
  /** Where the take was tuned against A = 440. Positive is sharp. */
  tuningCents: number;
  /** The typical note's distance from that tuning. */
  spreadCents: number;
  notes: number;
  inTuneCents: number;
  slightCents: number;
  tuningWorthSayingCents: number;
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
   * Profile photo. Null is a normal state, not an error to design around.
   *
   * **Two sources, and the account wins.** Since migration 009 there is an
   * `avatar_key` on `users` and an upload endpoint behind it, so a picture set
   * in onboarding or in Profile is the one to show. An OAuth provider's
   * metadata photo is the fallback for accounts that never set one, which is
   * what the app had before and all it had. Someone who deliberately cleared
   * their picture must not have Google's put back in its place, so the
   * fallback only applies when the account carries none.
   */
  avatarUrl: string | null;
  /**
   * What to call them, or null.
   *
   * Null is not a failure — it is what someone who skipped onboarding has, and
   * they are entitled to keep it. Anything greeting a musician has to read
   * this as "no name given" and say something that works without one.
   */
  displayName: string | null;
  /**
   * What they play, or null when nobody has asked.
   *
   * Distinct from the device preference, which always has a value. Null here
   * means the account has never been told, and it is what puts the onboarding
   * screen on screen.
   */
  instrument: Instrument | null;
  /**
   * Whether the onboarding screen has been shown — **not** whether it was
   * answered. Someone who skipped is onboarded: they were asked and declined.
   */
  onboarded: boolean;
  /**
   * Whether this musician explicitly allows corrected score readings and
   * their source pages to be retained to improve the reader.
   */
  trainingConsent: boolean;
}
