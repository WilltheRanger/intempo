import {
  apiInsightsSource,
  apiMusicianSource,
  apiPieceSource,
  apiTakeSource,
  apiTakeSubmissionSource,
} from './api';
import {
  fixtureInsightsSource,
  fixtureMusicianSource,
  fixturePieceSource,
  fixtureTakeSource,
  fixtureTakeSubmissionSource,
} from './fixtures';
import type {
  InsightsSource,
  MusicianSource,
  PieceSource,
  TakeSource,
  TakeSubmissionSource,
} from './types';

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

export const takeSource: TakeSource = USE_FIXTURES
  ? fixtureTakeSource
  : apiTakeSource;

/**
 * Where a finished recording goes.
 *
 * Capture is real on both sides of this flag — the microphone, the WAV and the
 * duration are genuine either way. Only the destination changes: storage and
 * the pipeline, or the sample take.
 */
export const takeSubmissionSource: TakeSubmissionSource = USE_FIXTURES
  ? fixtureTakeSubmissionSource
  : apiTakeSubmissionSource;

export {
  apiInsightsSource,
  apiMusicianSource,
  apiPieceSource,
  apiTakeSubmissionSource,
  fixtureInsightsSource,
  fixtureMusicianSource,
  fixturePieceSource,
  fixtureTakeSource,
  fixtureTakeSubmissionSource,
};
export type {
  InsightsSource,
  MusicianSource,
  PieceSource,
  TakeSource,
  TakeSubmissionSource,
};
