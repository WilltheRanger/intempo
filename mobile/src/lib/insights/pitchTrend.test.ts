import { describe, expect, it } from 'vitest';

import type { TakeIntonation, TakeResult } from '../../data/types';
import { pitchTrendFrom, pitchTrendLine, pitchY } from './pitchTrend';

const BANDS: TakeIntonation = {
  tuningCents: 0,
  spreadCents: 10,
  notes: 40,
  inTuneCents: 15,
  slightCents: 30,
  tuningWorthSayingCents: 10,
};

/** Newest first, as `getRecentTakes` returns them. */
function takes(spreads: (number | null)[]): TakeResult[] {
  return spreads.map(
    (spread, index) =>
      ({
        id: `take-${index}`,
        recordedAt: new Date(Date.UTC(2026, 8, 25 - index)).toISOString(),
        failure: null,
        status: 'ok',
        intonation: spread === null ? null : { ...BANDS, spreadCents: spread },
      }) as unknown as TakeResult,
  );
}

describe('pitchTrendFrom', () => {
  it('draws the takes oldest first', () => {
    const trend = pitchTrendFrom(takes([9, 12, 20]))!;

    expect(trend.points.map((p) => p.spreadCents)).toEqual([20, 12, 9]);
    expect(trend.inTuneCents).toBe(15);
  });

  it('leaves out takes that were not read for pitch', () => {
    expect(pitchTrendFrom(takes([9, null, 20]))!.points).toHaveLength(2);
  });

  it('is null with fewer than two takes to join', () => {
    expect(pitchTrendFrom(takes([9, null]))).toBeNull();
  });

  it('never scales so a steady player reads as wild', () => {
    expect(pitchTrendFrom(takes([4, 5]))!.top).toBe(30);
    expect(pitchTrendFrom(takes([9, 60]))!.top).toBe(75);
  });
});

describe('pitchTrendLine', () => {
  it('says the latest take in cents, and whether it is closer than the start', () => {
    expect(pitchTrendLine(takes([9, 12, 20]))).toBe(
      'Your notes sit within 15 cents of your tuning. Closer than your earliest take.',
    );
    expect(pitchTrendLine(takes([22, 12]))).toBe(
      'Your notes sit about 22 cents from your tuning. Further out than your earliest take.',
    );
    expect(pitchTrendLine(takes([22, 21]))).toBe('Your notes sit about 22 cents from your tuning.');
  });

  it('works from one take, and says nothing with none', () => {
    expect(pitchTrendLine(takes([9]))).toBe('Your notes sit within 15 cents of your tuning.');
    expect(pitchTrendLine(takes([null]))).toBeNull();
  });
});

describe('pitchY', () => {
  it('puts in tune at the bottom and clamps past the top', () => {
    const trend = pitchTrendFrom(takes([0, 30]))!;

    expect(pitchY(0, trend)).toBe(1);
    expect(pitchY(trend.top * 2, trend)).toBe(0);
  });
});
