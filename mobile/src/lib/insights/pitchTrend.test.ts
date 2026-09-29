import { describe, expect, it } from 'vitest';

import type { TakeIntonation, TakeResult } from '../../data/types';
import { pitchTrendData, pitchTrendFrom, pitchTrendLine } from './pitchTrend';

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

  it('leaves out a take saved before pitch was read, without throwing', () => {
    // Restored from the launch cache, a take from before 2026-09-25 has no
    // `intonation` at all — `undefined`, which `!== null` let through to
    // `.spreadCents`, and the app did not start.
    const saved = takes([9, 20]);
    delete (saved[1] as Partial<TakeResult>).intonation;

    expect(() => pitchTrendFrom(saved)).not.toThrow();
    expect(pitchTrendFrom(saved)).toBeNull();
    expect(() => pitchTrendLine(saved)).not.toThrow();
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
  it('says which way it went, in a few words', () => {
    expect(pitchTrendLine(takes([9, 12, 20]))).toBe('Closer than before');
    expect(pitchTrendLine(takes([22, 12]))).toBe('Further out than before');
  });

  it('says where the latest sits when nothing moved', () => {
    expect(pitchTrendLine(takes([22, 21]))).toBe('About 22 cents off');
    expect(pitchTrendLine(takes([9]))).toBe('In tune');
    expect(pitchTrendLine(takes([null]))).toBeNull();
  });
});

describe('pitchTrendData', () => {
  it('draws the in-tune band along the floor, gold past it and red past slight', () => {
    const data = pitchTrendData(pitchTrendFrom(takes([9, 20, 40]))!)!;

    expect(data.band[0]).toMatchObject({ low: 0, high: 15, farHigh: 30 });
    // Oldest first: 40 (red), 20 (gold), 9 (in tune).
    expect(data.runs[0].map((p) => p.tone)).toEqual(['verdictBad', 'verdictMid', null]);
    expect(data.min).toBeLessThan(0);
  });
});
