import type { SubmitTakeInput } from '../practice/submitTake';
import type {
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
}

/** The same seam for the signed-in account. */
export interface MusicianSource {
  /**
   * The signed-in musician.
   *
   * Against the real backend this is also the provisioning call: it creates
   * the `public.users` row on first touch, and other endpoints fail until it
   * has run. Keep it the first authenticated request after sign-in.
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
