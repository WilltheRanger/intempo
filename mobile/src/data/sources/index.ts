import { apiMusicianSource, apiPieceSource } from './api';
import { fixtureMusicianSource, fixturePieceSource } from './fixtures';
import type { MusicianSource, PieceSource } from './types';

/**
 * Flip to `false` once the backend can serve progress, last-practiced, and
 * score thumbnails. Nothing else in the app changes — that is the point of
 * routing every screen through `PieceSource`.
 */
const USE_FIXTURES: boolean = true;

export const pieceSource: PieceSource = USE_FIXTURES
  ? fixturePieceSource
  : apiPieceSource;

/**
 * The account follows the same flag, but for a different reason: `/v1/me`
 * serves every field the Profile screen renders, so this one is fixture-backed
 * only because there is no sign-in yet to produce a token.
 */
export const musicianSource: MusicianSource = USE_FIXTURES
  ? fixtureMusicianSource
  : apiMusicianSource;

export { apiMusicianSource, apiPieceSource, fixtureMusicianSource, fixturePieceSource };
export type { MusicianSource, PieceSource };
