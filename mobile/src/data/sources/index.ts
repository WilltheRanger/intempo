import { apiMusicianSource, apiPieceSource } from './api';
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
 * Insights has no API implementation, and deliberately ignores the flag above.
 *
 * It would read `/v1/analyses`, which is unbuilt (Batch 4). Unlike the piece
 * adapter there is no partial answer to give: with no analyses there is
 * nothing to aggregate, and an empty result would tell a musician who has
 * practised plenty that they haven't. Better to stay on fixtures until the
 * endpoint exists than to ship a screen that lies when the flag flips.
 */
export const insightsSource: InsightsSource = fixtureInsightsSource;

export {
  apiMusicianSource,
  apiPieceSource,
  fixtureInsightsSource,
  fixtureMusicianSource,
  fixturePieceSource,
};
export type { InsightsSource, MusicianSource, PieceSource };
