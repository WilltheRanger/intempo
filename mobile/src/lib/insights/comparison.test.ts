import { expect, it } from 'vitest';
import type { TakeResult } from '../../data/types';
import { compareLatest } from './comparison';

const take = (id: string, date: string, deviation: number): TakeResult => ({
  id, recordedAt: date, comparisonKey: 'v1:score-settings', pieceId: 'piece',
  targetBpm: 80, failure: null, status: 'ok', lowConfidence: false,
  missedNotes: 0, extraNotes: 0,
  measures: [{ measure: 1, noteCount: 4, timedNoteCount: 4, deviationPct: deviation,
    uneven: false, underTempoChange: false }],
} as TakeResult);
const previous = take('old', '2026-09-01', -4);
const latest = take('new', '2026-09-02', 2);

it('compares absolute bar averages and sorts by time', () => {
  expect(compareLatest([previous, latest])).toMatchObject({
    previousDeviation: 4, latestDeviation: 2,
  });
});
it.each([
  { comparisonKey: null }, { comparisonKey: 'v1:different-score' },
  { targetBpm: 90 }, { lowConfidence: true }, { missedNotes: 1 },
  { extraNotes: 1 }, { status: 'no_onsets' },
])('refuses an unsafe comparison: %j', (change) => {
  expect(compareLatest([previous, { ...latest, ...change } as TakeResult])).toBeNull();
});
it('refuses different played bars and uneven bar averages', () => {
  for (const change of [{ measure: 2 }, { timedNoteCount: 3 }, { uneven: true }]) {
    expect(compareLatest([previous, { ...latest,
      measures: [{ ...latest.measures[0], ...change }],
    }])).toBeNull();
  }
});
