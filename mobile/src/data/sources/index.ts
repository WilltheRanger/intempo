import { apiPieceSource } from './api';
import { fixturePieceSource } from './fixtures';
import type { PieceSource } from './types';

/**
 * Flip to `false` once the backend can serve progress, last-practiced, and
 * score thumbnails. Nothing else in the app changes — that is the point of
 * routing every screen through `PieceSource`.
 */
const USE_FIXTURES: boolean = true;

export const pieceSource: PieceSource = USE_FIXTURES
  ? fixturePieceSource
  : apiPieceSource;

export { apiPieceSource, fixturePieceSource };
export type { PieceSource };
