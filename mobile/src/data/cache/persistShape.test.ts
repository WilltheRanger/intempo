import { describe, expect, it } from 'vitest';

import type {
  MeasureVerdict,
  Musician,
  Piece,
  PracticeInsights,
  TakeIntonation,
  TakeResult,
} from '../types';
import { CACHE_SHAPE } from './persistCache';

/**
 * **The launch cache's shape number, held to the types it saves.**
 *
 * On 2026-09-25 the app would not start on a phone that had saved takes the
 * day before: takes had gained two fields in three days and `CACHE_SHAPE`
 * had not moved, so the saved ones came back without them and the Insights
 * tab threw on the first. Nothing tied the number to the types, and the rule
 * in its comment named `pieceForDisk` alone.
 *
 * Each list below is every field of a type the cache saves, as a
 * `Record<keyof T, true>` — so **a field added or removed stops this file
 * compiling**, and `tsc` runs in CI. Put the field in the list, bump
 * `CACHE_SHAPE`, and set `SHAPE` here to match: the test below fails until
 * both say the same number, which is the reminder that the first is not
 * optional. Nested types other than a take's bars and pitch are left out;
 * those two are the ones the screens read field by field.
 */
const SHAPE = 4;

const TAKE: Record<keyof TakeResult, true> = {
  comparisonKey: true,
  id: true,
  recordingAvailable: true,
  pieceId: true,
  pieceTitle: true,
  composer: true,
  recordedAt: true,
  targetBpm: true,
  tempoBeatUnit: true,
  failure: true,
  status: true,
  headline: true,
  finding: true,
  direction: true,
  verdict: true,
  lowConfidence: true,
  measures: true,
  trend: true,
  tolerance: true,
  intonation: true,
  missedNotes: true,
  extraNotes: true,
  wrongNotes: true,
  restEntries: true,
};

const BAR: Record<keyof MeasureVerdict, true> = {
  measure: true,
  playedBpm: true,
  pitchCents: true,
  targetBpm: true,
  noteCount: true,
  deviationPct: true,
  band: true,
  direction: true,
  verdict: true,
  underTempoChange: true,
  uneven: true,
  timedNoteCount: true,
  untimedReason: true,
};

const PITCH: Record<keyof TakeIntonation, true> = {
  tuningCents: true,
  spreadCents: true,
  notes: true,
  inTuneCents: true,
  slightCents: true,
  tuningWorthSayingCents: true,
};

const READINGS: Record<keyof PracticeInsights, true> = {
  windowDays: true,
  sessions: true,
  meanDeviationPct: true,
  spreadPct: true,
  band: true,
  direction: true,
  verdict: true,
  tolerance: true,
  pieces: true,
};

const ACCOUNT: Record<keyof Musician, true> = {
  usage: true,
  id: true,
  email: true,
  tier: true,
  role: true,
  studioId: true,
  avatarUrl: true,
  displayName: true,
  instrument: true,
  onboarded: true,
  trainingConsent: true,
};

const PIECE: Record<keyof Piece, true> = {
  id: true,
  title: true,
  composer: true,
  movement: true,
  lastPracticedAt: true,
  thumbnail: true,
  pages: true,
  markedBpm: true,
  score: true,
  concerns: true,
  transcriptionStatus: true,
  transcriptionStage: true,
  transcriptionError: true,
  transcriptionAccepted: true,
  pageImageDiscarded: true,
};

describe('the launch cache', () => {
  it('is numbered for the shape of what it saves', () => {
    // Read so the lists are not dead code; the compiler is what checks them.
    const fields = [TAKE, BAR, PITCH, READINGS, ACCOUNT, PIECE].map((t) => Object.keys(t).length);
    expect(fields).toEqual([24, 13, 6, 9, 11, 15]);
    expect(CACHE_SHAPE, 'a saved type changed: bump CACHE_SHAPE and SHAPE together').toBe(SHAPE);
  });
});
