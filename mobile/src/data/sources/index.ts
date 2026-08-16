import {
  apiInsightsSource,
  apiMusicianSource,
  apiPieceSource,
} from './api';
import {
  fixtureInsightsSource,
  fixtureMusicianSource,
  fixturePieceSource,
} from './fixtures';
import type { InsightsSource, MusicianSource, PieceSource } from './types';

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

/**
 * Insights now follows the flag like everything else: `GET /v1/analyses`
 * exists, and the adapter aggregates the caller's finished takes over the
 * same window the fixture describes.
 */
export const insightsSource: InsightsSource = USE_FIXTURES
  ? fixtureInsightsSource
  : apiInsightsSource;

export {
  apiInsightsSource,
  apiMusicianSource,
  apiPieceSource,
  fixtureInsightsSource,
  fixtureMusicianSource,
  fixturePieceSource,
};
export type { InsightsSource, MusicianSource, PieceSource };
