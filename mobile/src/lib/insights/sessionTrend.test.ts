import { describe, expect, it } from 'vitest';

import type { TakeResult, Tolerance } from '../../data/types';
import { axisLabels, plotFraction, sessionTrendFrom, trendRange } from './sessionTrend';

const TOLERANCE: Tolerance = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 12,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 12,
  dragging_outer_pct: 20,
};

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

  it('marks what counts as off with the band, not with the chart’s height', () => {
    // The chart used to be scaled to the outer threshold so that its top edge
    // meant "severe". The redesign fits the axis to the takes instead, and the
    // on-tempo band — the take's own inner thresholds — is what says where
    // "off the beat" begins.
    const trend = sessionTrendFrom([take(), take({ id: 't2' })], TOLERANCE);
    expect(trend?.range.bandTop).toBe(5);
    expect(trend?.range.bandBottom).toBe(-5);

    const noTolerance = sessionTrendFrom([take(), take({ id: 't2' })], null);
    expect(noTolerance?.range.bandTop).toBeGreaterThan(0);
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

  it('plots every take, oldest first', () => {
    expect(series([2, 9, -5, 3])?.points.map((p) => p.value)).toEqual([2, 9, -5, 3]);
  });
});

describe('the span a take chart draws', () => {
  it('fits a musician who rushes, rather than spending half the chart behind the beat', () => {
    const range = trendRange([2, 6, 11, 14], TOLERANCE);
    expect(range.top).toBeGreaterThan(14);
    // The band still shows below the line, and not much more.
    expect(range.bottom).toBeLessThan(-5);
    expect(-range.bottom).toBeLessThan(range.top / 2);
  });

  it('always holds the whole on-tempo band', () => {
    const range = trendRange([0.5, 1, 0.2], TOLERANCE);
    expect(range.top).toBeGreaterThan(range.bandTop);
    expect(range.bottom).toBeLessThan(range.bandBottom);
    expect([range.bandTop, range.bandBottom]).toEqual([5, -5]);
  });

  it('does not let one wild take flatten the rest', () => {
    expect(trendRange([3, 4, 200], TOLERANCE).top).toBeLessThan(40);
  });

  it('names only the directions somebody played in', () => {
    const rushing = [2, 6, 11, 14];
    expect(axisLabels(rushing, trendRange(rushing, TOLERANCE))).toEqual({ ahead: true, behind: false });
    const dragging = [-12, -3, 1];
    expect(axisLabels(dragging, trendRange(dragging, TOLERANCE))).toEqual({ ahead: false, behind: true });
  });
});

describe('placing a value on the plot', () => {
  const range = trendRange([-10, 10], TOLERANCE);

  it('puts ahead of the beat above the line', () => {
    // Rush-positive is up, which means negating: SVG's y grows downward, and
    // "ahead" is the top of every other tempo drawing in the app.
    expect(plotFraction(10, range)).toBeLessThan(plotFraction(0, range));
    expect(plotFraction(-10, range)).toBeGreaterThan(plotFraction(0, range));
  });

  it('pins a value past the span to the edge', () => {
    expect(plotFraction(500, range)).toBe(0);
    expect(plotFraction(-500, range)).toBe(1);
  });

  it('centres rather than dividing by zero', () => {
    expect(plotFraction(5, { top: 0, bottom: 0, bandTop: 0, bandBottom: 0 })).toBe(0.5);
  });
});
