import type { Musician, Piece, PracticeInsights } from '../types';

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
