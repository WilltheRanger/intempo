import { describe, expect, it } from 'vitest';

import type { TakeResult, Tolerance } from '../../data/types';
import { plotFraction, sessionTrendFrom } from './sessionTrend';

const TOLERANCE: Tolerance = {
  rushing_outer_pct: 20,
  dragging_outer_pct: 20,
} as unknown as Tolerance;

function take(over: Partial<TakeResult> = {}): TakeResult {
  return {
    id: 't1',
    recordedAt: '2026-09-01T10:00:00Z',
    failure: null,
    trend: [2, 4, 6],
    ...over,
  } as unknown as TakeResult;
}

describe('building the series', () => {
  it('reads left to right as time, whatever order the API returned', () => {
    // `getRecentTakes` answers newest first, which is right for a list and
    // backwards for a chart of time.
    const trend = sessionTrendFrom(
      [
        take({ id: 'c', recordedAt: '2026-09-03T10:00:00Z' }),
        take({ id: 'a', recordedAt: '2026-09-01T10:00:00Z' }),
        take({ id: 'b', recordedAt: '2026-09-02T10:00:00Z' }),
      ],
      TOLERANCE,
    );

    expect(trend?.points.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('summarises each session as the mean of its own rolling trend', () => {
    // The same measurement the verdict screen draws as a line, summarised --
    // not a second figure computed differently, which is how two screens end
    // up disagreeing about one take.
    const trend = sessionTrendFrom([take({ trend: [0, 10, 20] }), take({ id: 't2', trend: [-6, -6] })], TOLERANCE);

    expect(trend?.points.map((p) => p.value)).toEqual([10, -6]);
  });

  it('leaves out a run that failed', () => {
    // Every field below `failure` is a placeholder when it is set. Plotting
    // one draws the placeholder as though somebody had played it.
    const trend = sessionTrendFrom(
      [
        take({ id: 'ok-1', recordedAt: '2026-09-01T10:00:00Z' }),
        take({
          id: 'failed',
          recordedAt: '2026-09-02T10:00:00Z',
          failure: { recoverable: true, reason: 'internal_error' },
        } as Partial<TakeResult>),
        take({ id: 'ok-2', recordedAt: '2026-09-03T10:00:00Z' }),
      ],
      TOLERANCE,
    );

    expect(trend?.points.map((p) => p.id)).toEqual(['ok-1', 'ok-2']);
  });

  it('leaves out a take the pipeline produced no trend for', () => {
    const trend = sessionTrendFrom(
      [take({ id: 'empty', trend: [] }), take({ id: 'a' }), take({ id: 'b', recordedAt: '2026-09-02T10:00:00Z' })],
      TOLERANCE,
    );

    expect(trend?.points.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('refuses to draw a trend from one session', () => {
    // Null rather than a chart with a single dot on it: an axis with one point
    // reads as a measurement, and the caller's empty state can say "not enough
    // sessions yet", which is the true thing.
    expect(sessionTrendFrom([take()], TOLERANCE)).toBeNull();
    expect(sessionTrendFrom([], TOLERANCE)).toBeNull();
  });

  it('takes its scale from the thresholds, not from the data', () => {
    // A point at the top of the chart has to mean "severe", not "the tallest
    // thing that happened to be in this window".
    const trend = sessionTrendFrom([take(), take({ id: 't2' })], TOLERANCE);
    expect(trend?.fullScale).toBe(20);

    const noTolerance = sessionTrendFrom([take(), take({ id: 't2' })], null);
    expect(noTolerance?.fullScale).toBeGreaterThan(0);
  });
});

describe('which points get a dot', () => {
  const series = (values: number[]) =>
    sessionTrendFrom(
      values.map((value, index) => take({
        id: `t${index}`,
        trend: [value],
        recordedAt: `2026-09-0${index + 1}T10:00:00Z`,
      })),
      TOLERANCE,
    );

  it('marks the latest session, the highest and the lowest', () => {
    const trend = series([2, 9, -5, 3]);
    expect(trend?.points.map((p) => p.notable)).toEqual([false, true, true, true]);
  });

  it('does not mark every point', () => {
    // The difference between a chart and a list of dots joined up.
    const trend = series([1, 2, 3, 4, 5, 6, 7]);
    expect(trend?.points.filter((p) => p.notable)).toHaveLength(2); // latest is also the highest
  });

  it('marks only the latest when nothing moved', () => {
    // A flat series would otherwise get dots on two arbitrary points and imply
    // a spread that is not there.
    const trend = series([4, 4, 4]);
    expect(trend?.points.map((p) => p.notable)).toEqual([false, false, true]);
  });
});

describe('placing a value on the plot', () => {
  it('puts ahead of the beat above the centre line', () => {
    // Rush-positive is up, which means negating: SVG's y grows downward, and
    // "ahead" is the top of every other tempo drawing in the app.
    expect(plotFraction(10, 20)).toBeLessThan(0.5);
    expect(plotFraction(-10, 20)).toBeGreaterThan(0.5);
    expect(plotFraction(0, 20)).toBe(0.5);
  });

  it('pins a session past the threshold to the edge', () => {
    expect(plotFraction(200, 20)).toBe(0);
    expect(plotFraction(-200, 20)).toBe(1);
  });

  it('centres rather than dividing by zero', () => {
    expect(plotFraction(5, 0)).toBe(0.5);
  });
});
