import type { SubmitTakeInput } from '../practice/submitTake';
import type {
  Clef,
  Musician,
  Piece,
  PracticeInsights,
  TakeResult,
} from '../types';

/**
 * The seam between the UI and the backend.
 *
 * Screens talk to hooks; hooks talk to a `PieceSource`. Swapping the fixture
 * implementation for the API implementation is a one-line change in
 * `sources/index.ts` and touches no component.
 */
export interface PieceSource {
  /** The musician's repertoire, most recently worked on first. */
  listPieces(): Promise<Piece[]>;
  /** The piece to continue practicing, or null when the library is empty. */
  getCurrentPiece(): Promise<Piece | null>;
  getPiece(id: string): Promise<Piece | null>;
  /**
   * Adds a piece the musician typed in rather than photographed.
   *
   * Deliberately narrower than the endpoint behind it: the transcribed path
   * runs OCR, takes ten seconds and belongs to the capture flow, which owns
   * its own progress state. This is the instant one, and the only way into
   * the library that needs no camera, no network round trip to an OCR
   * provider, and no API keys.
   */
  createPiece(input: NewPiece): Promise<Piece>;
  /** Corrects what a piece is called. Nothing else about it is editable. */
  updatePiece(id: string, input: PieceEdit): Promise<Piece>;
  /**
   * Removes a piece from the library.
   *
   * **Rejects when the piece has been recorded against.** `analyses.score_id`
   * is `ON DELETE RESTRICT` and there is no soft delete, so the backend answers
   * 409 rather than destroying the practice history attached to it. Callers
   * must show that reason — it is a rule about the musician's own data, not a
   * transient failure to retry.
   */
  deletePiece(id: string): Promise<void>;
}

/** What can be corrected after the fact. */
export interface PieceEdit {
  title: string;
  composer: string | null;
  movement: string | null;
}

/**
 * Why a piece with recordings can't be removed, in the musician's terms.
 *
 * The backend's own sentence is *"score has dependent analyses; delete those
 * first (soft-delete is V2)"* — correct for an API consumer, and three kinds
 * of wrong on a phone: it says "score" for a piece, "analyses" for
 * recordings, and carries an internal roadmap note. Both sources raise this
 * instead, so the two agree and neither invents its own wording.
 */
export const PIECE_HAS_RECORDINGS =
  "You've recorded this piece, so it stays in your library — removing it would take that practice history with it.";

/** What the Add-manually form collects. */
export interface NewPiece {
  title: string;
  composer: string | null;
  /** e.g. "I. Adagio". Null for music with no movements. */
  movement: string | null;
  /**
   * Which staff the piece is written on. Not asked for: it is derived from
   * the musician's instrument, because a form field for it would be a
   * question most people can't answer about a piece they're describing from
   * memory, and the instrument gets it right nearly always.
   */
  clef: Clef;
  /** `"4/4"`, or null when they left it blank. */
  timeSignature: string | null;
  /** The tempo to practise at, or null. */
  bpm: number | null;
}

/** The same seam for the signed-in account. */
export interface MusicianSource {
  /**
   * The signed-in musician.
   *
   * An ordinary read, callable in any order. It also creates the
   * `public.users` row on first touch, but nothing depends on that any more:
   * the writes that need the row provision it themselves. See `useMe`.
   */
  getMusician(): Promise<Musician>;
}

/** Aggregate practice history, for the Insights tab. */
export interface InsightsSource {
  /** Null when the musician has no completed analyses in the window. */
  getInsights(): Promise<PracticeInsights | null>;
}

/** One analysed take, for the verdict screen. */
export interface TakeSource {
  /** Null when the id doesn't exist or isn't the caller's. */
  getTake(analysisId: string): Promise<TakeResult | null>;
  /**
   * The most recent finished take, across every piece.
   *
   * Today asks "how did last time go" and that is a different question from
   * the 30-day aggregate Insights answers. Null before the pipeline has
   * finished anything — the normal state of a new account, not an error.
   */
  getLatestTake(): Promise<TakeResult | null>;
  /** Finished, readable takes, newest first. */
  getRecentTakes(limit?: number): Promise<TakeResult[]>;
}

/**
 * Sending a take away to be analysed.
 *
 * A write rather than a read, but it belongs to the same seam for the same
 * reason: the recording screen shouldn't know whether a take is going to
 * storage or to a fixture, and one flag should decide it for the whole app.
 *
 * Capture is real either way — a microphone needs no backend. This seam only
 * governs what happens to the audio afterwards.
 */
export interface TakeSubmissionSource {
  /**
   * Uploads the take, waits for the pipeline, and returns the analysis id to
   * show. Rejects if the upload fails or the analysis never finishes.
   */
  submit(input: SubmitTakeInput): Promise<string>;
}
