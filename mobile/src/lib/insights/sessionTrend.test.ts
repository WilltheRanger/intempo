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

/**
 * A take whose bars were played `bars` percent off a target of 100. Each
 * bar's drift is a wild figure on purpose — the series must be read from the
 * tempo, and a test that passed on either would not show which.
 */
function take(over: Partial<TakeResult> & { bars?: number[] } = {}): TakeResult {
  const { bars = [2, 4, 6], ...rest } = over;
  return {
    id: 't1',
    recordedAt: '2026-09-01T10:00:00Z',
    failure: null,
    targetBpm: 100,
    trend: bars.map(() => -500),
    measures: bars.map((pct, index) => ({
      measure: index + 1,
      playedBpm: 100 + pct,
      targetBpm: null,
      pitchCents: null,
      noteCount: 4,
      deviationPct: -300 * (index + 1),
      band: 'severe',
      direction: 'drag',
      verdict: 'dragging',
      underTempoChange: false,
      uneven: false,
      timedNoteCount: 4,
      untimedReason: null,
    })),
    ...rest,
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

  it('summarises each session as the median of its bars’ tempo against the target', () => {
    // The measurement the verdict's charts draw, summarised -- not drift,
    // which a take held slow grows along its length until every take sits on
    // the chart's floor.
    const trend = sessionTrendFrom(
      [take({ bars: [0, 10, 20] }), take({ id: 't2', bars: [-6, -6, 40] })],
      TOLERANCE,
    );

    expect(trend?.points.map((p) => Number(p.value.toFixed(6)))).toEqual([10, -6]);
  });

  it('judges a bar against the tempo the page set for it', () => {
    // A meno mosso at 88, played at 88, is on its target -- not 12 under 100.
    const meno = take({ bars: [0, 0] });
    meno.measures.push({ ...meno.measures[0], measure: 3, playedBpm: 88, targetBpm: 88 });
    const trend = sessionTrendFrom([meno, take({ id: 't2' })], TOLERANCE);

    expect(trend?.points[0].value).toBe(0);
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

  it('leaves out a take with no bar to time', () => {
    const trend = sessionTrendFrom(
      [take({ id: 'empty', bars: [] }), take({ id: 'a' }), take({ id: 'b', recordedAt: '2026-09-02T10:00:00Z' })],
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
    // "off tempo" begins.
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
        bars: [value],
        recordedAt: `2026-09-0${index + 1}T10:00:00Z`,
      })),
      TOLERANCE,
    );

  it('plots every take, oldest first', () => {
    expect(series([2, 9, -5, 3])?.points.map((p) => Number(p.value.toFixed(6)))).toEqual([2, 9, -5, 3]);
  });
});

describe('the span a take chart draws', () => {
  it('fits a musician who plays fast, rather than spending half the chart on slower', () => {
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

  it('keeps the band a band when every take was on tempo', () => {
    // Fitted tightly, takes inside the band made the band the whole plot.
    const range = trendRange([1, 2, 3], TOLERANCE);
    const band = range.bandTop - range.bandBottom;
    expect(band / (range.top - range.bottom)).toBeLessThanOrEqual(0.4);
    // Leaning a little fast, it leans a little up: more room above than below.
    expect(range.top).toBeGreaterThan(-range.bottom);
  });

  it('keeps the target mid-plot when the takes sit on it', () => {
    const range = trendRange([-2, 0, 2], TOLERANCE);
    expect(Math.abs(range.top + range.bottom)).toBeLessThan(1e-9);
  });

  it('lengthens a short span toward the side the takes lean', () => {
    const range = trendRange([-6, -7, -6], TOLERANCE);
    expect(-range.bottom).toBeGreaterThan(range.top * 2);
  });

  it('does not let one wild take flatten the rest', () => {
    expect(trendRange([3, 4, 200], TOLERANCE).top).toBeLessThan(40);
  });

  it('names only the directions somebody played in', () => {
    const rushing = [2, 6, 11, 14];
    expect(axisLabels(rushing, trendRange(rushing, TOLERANCE))).toEqual({ faster: true, slower: false });
    const dragging = [-12, -3, 1];
    expect(axisLabels(dragging, trendRange(dragging, TOLERANCE))).toEqual({ faster: false, slower: true });
  });
});

describe('placing a value on the plot', () => {
  const range = trendRange([-10, 10], TOLERANCE);

  it('puts faster above the line', () => {
    // Rush-positive is up, which means negating: SVG's y grows downward, and
    // Faster is the top of every other tempo drawing in the app.
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
