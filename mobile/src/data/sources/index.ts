import { IS_LIVE_BACKEND } from '../environment';
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
 * Which side of the seam this build is on.
 *
 * Was a hardcoded `USE_FIXTURES = true` that someone had to remember to flip.
 * It is now a fact about the environment — see `../environment.ts` for why
 * that distinction is load-bearing rather than tidy.
 */
const USE_FIXTURES: boolean = !IS_LIVE_BACKEND;

export const pieceSource: PieceSource = USE_FIXTURES
  ? fixturePieceSource
  : apiPieceSource;

/**
 * The account follows the same switch, for the same reason as everything
 * else: `/v1/me` serves every field the Profile screen renders, and it needs
 * a bearer token that only a configured Supabase client can produce.
 */
export const musicianSource: MusicianSource = USE_FIXTURES
  ? fixtureMusicianSource
  : apiMusicianSource;

/**
 * Insights follows it too: `GET /v1/analyses` exists, and the adapter
 * aggregates the caller's finished takes over the same window the fixture
 * describes.
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
 * Capture is real on both sides of this seam — the microphone, the WAV and the
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
