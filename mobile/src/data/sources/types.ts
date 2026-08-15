import type { Piece } from '../types';

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
