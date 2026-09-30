import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeIntonation, Tolerance } from '../../data/types';
import {
  barAtAlong,
  centreLabelTop,
  curveSpan,
  outsidePath,
  smoothPath,
  takePitchTrend,
  tempoTrend,
  trendY,
} from './trend';

const TOLERANCE: Tolerance = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 10,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 10,
  dragging_outer_pct: 20,
};

const INTONATION: TakeIntonation = {
  tuningCents: 0,
  spreadCents: 10,
  notes: 40,
  inTuneCents: 15,
  slightCents: 30,
  tuningWorthSayingCents: 10,
  byNote: [],
  byNoteShowNotes: 4,
};

function bar(measure: number, playedBpm: number | null, over: Partial<MeasureVerdict> = {}) {
  const value: MeasureVerdict = {
    measure,
    playedBpm,
    pitchCents: null,
    targetBpm: null,
    noteCount: 4,
    deviationPct: 0,
    band: 'on',
    direction: 'on',
    verdict: 'on_tempo',
    underTempoChange: false,
    uneven: false,
    timedNoteCount: 4,
    untimedReason: null,
    ...over,
  };
  return value;
}

// Against 96: steady, a rush in the middle, back again.
const TAKE = [96, 96, 97, 104, 112, 106, 97, 96, 95].map((bpm, i) => bar(i + 1, bpm));

describe('the tempo trend', () => {
  const trend = tempoTrend(TAKE, 96, 'quarter', TOLERANCE)!;

  it('draws the take as one line from its first bar to its last', () => {
    expect(trend.runs).toHaveLength(1);
    expect(trend.runs[0][0].at).toBe(0);
    expect(trend.runs[0][8].at).toBe(1);
  });

  it('smooths a bar with its neighbours, so one bar cannot spike the line', () => {
    // Bar 5 was played at 112; with 104 and 106 either side it draws at 107.3.
    expect(trend.runs[0][4].value).toBeCloseTo(107.33, 2);
  });

  it('is ink inside the band and takes the verdict colour only outside it', () => {
    expect(trend.runs[0][0].tone).toBeNull();
    expect(trend.runs[0][4].tone).toBe('verdictBad');
    expect(trend.runs[0][8].tone).toBeNull();
  });

  it('draws the band around the target, and labels the target', () => {
    expect(trend.band[0]).toMatchObject({ centre: 96 });
    expect(trend.band[0].low).toBeLessThan(96);
    expect(trend.band[0].high).toBeGreaterThan(96);
    expect(trend.centreLabel).toBe('96');
    expect(trend.min).toBeLessThan(trend.band[0].low);
    expect(trend.max).toBeGreaterThan(107);
  });

  it('breaks the line at a bar with no tempo rather than drawing through it', () => {
    const gapped = [...TAKE.slice(0, 4), bar(5, null), ...TAKE.slice(5)];
    expect(tempoTrend(gapped, 96, 'quarter', TOLERANCE)!.runs).toHaveLength(2);
  });

  it('draws nothing for a take with fewer than two timed bars', () => {
    expect(tempoTrend([bar(1, 96)], 96, 'quarter', TOLERANCE)).toBeNull();
    expect(tempoTrend([bar(1, null), bar(2, null)], 96, 'quarter', TOLERANCE)).toBeNull();
  });
});

describe('the pitch trend', () => {
  it('is cents off the player’s tuning, with the in-tune distance either side', () => {
    const pitched = [0, 4, -40, -44, -38, 2].map((cents, i) => bar(i + 1, 96, { pitchCents: cents }));
    const trend = takePitchTrend(pitched, INTONATION)!;
    expect(trend.band[0]).toMatchObject({ centre: 0, low: -15, high: 15 });
    expect(trend.runs[0][3].tone).toBe('verdictBad');
    expect(trend.runs[0][0].tone).toBeNull();
    expect(trend.centreLabel).toBeNull();
  });

  it('draws nothing without pitch', () => {
    expect(takePitchTrend([bar(1, 96), bar(2, 96)], INTONATION)).toBeNull();
    expect(takePitchTrend([bar(1, 96)], null)).toBeNull();
  });
});

describe('placing things on the graph', () => {
  it('puts the top of the range at the top', () => {
    const trend = tempoTrend(TAKE, 96, 'quarter', TOLERANCE)!;
    expect(trendY(trend.max, trend, 100)).toBe(0);
    expect(trendY(trend.min, trend, 100)).toBe(100);
  });

  it('finds the bar under a finger', () => {
    expect(barAtAlong(0, 9)).toBe(0);
    expect(barAtAlong(1, 9)).toBe(8);
    expect(barAtAlong(0.5, 9)).toBe(4);
    expect(barAtAlong(2, 9)).toBe(8);
  });
});

describe('the far edge', () => {
  it('is where the tolerance stops calling it slight', () => {
    const band = tempoTrend(TAKE, 96, 'quarter', TOLERANCE)!.band[0];
    // 96 ± 10%: gold inside, red beyond.
    expect(band.farHigh).toBeCloseTo(105.6);
    expect(band.farLow).toBeCloseTo(86.4);
  });

  it('is the slight distance for pitch', () => {
    const band = takePitchTrend(
      [bar(1, null, { pitchCents: 5 }), bar(2, null, { pitchCents: -20 })],
      INTONATION,
    )!.band[0];
    expect([band.farLow, band.farHigh]).toEqual([-30, 30]);
  });
});

/** The y of every point a path string moves or curves through, controls included. */
function ys(d: string): number[] {
  return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
}

describe('the smooth line', () => {
  it('passes through every point', () => {
    const points = [
      { x: 0, y: 50 },
      { x: 10, y: 20 },
      { x: 20, y: 40 },
    ];
    const d = smoothPath(points);
    for (const p of points) expect(d).toContain(`${p.x},${p.y}`);
  });

  it('never draws a peak higher than the bar that made it', () => {
    // A rush that tops out at y=10: nothing on the curve may go above it,
    // controls included, or the line shows a tempo nobody played.
    const d = smoothPath([
      { x: 0, y: 60 },
      { x: 10, y: 30 },
      { x: 20, y: 10 },
      { x: 30, y: 30 },
      { x: 40, y: 60 },
    ]);
    expect(Math.min(...ys(d))).toBe(10);
    expect(Math.max(...ys(d))).toBe(60);
  });

  it('is a dot for one point and nothing for none', () => {
    expect(smoothPath([{ x: 4, y: 5 }])).toBe('M 4,5');
    expect(smoothPath([])).toBe('');
  });
});

describe('the region outside the band', () => {
  const band = tempoTrend(TAKE, 96, 'quarter', TOLERANCE)!.band;
  const toX = (at: number) => at * 100;
  const toY = (value: number) => 200 - value;

  it('is two closed shapes, one above the band and one below', () => {
    const d = outsidePath(band, 'near', toX, toY, 50);
    expect(d.match(/Z/g)).toHaveLength(2);
    // Along the band's top edge (100.8 → y 99.2) and bottom (91.2 → y 108.8).
    expect(d).toContain(',99.2 ');
    expect(d).toContain(',108.8 ');
  });

  it('runs along the far edges for the red', () => {
    const d = outsidePath(band, 'far', toX, toY, 50);
    // 105.6 → y 94.4, and 86.4 → y 113.6.
    expect(d).toContain(',94.4');
    expect(d).toContain(',113.6');
  });
});

describe('where the curve runs', () => {
  const points = [
    { x: 0, y: 10 },
    { x: 100, y: 60 },
    { x: 200, y: 90 },
  ];

  it('is the points themselves at the ends', () => {
    expect(curveSpan(points, 200, 200)).toEqual({ top: 90, bottom: 90 });
    expect(curveSpan(points, 0, 0)).toEqual({ top: 10, bottom: 10 });
  });

  it('covers every point inside the span and where the span cuts the curve', () => {
    const span = curveSpan(points, 50, 150)!;
    expect(span.top).toBeLessThan(60);
    expect(span.top).toBeGreaterThan(10);
    expect(span.bottom).toBeGreaterThan(60);
    expect(span.bottom).toBeLessThan(90);
  });

  it('never goes past the two points a piece joins, as the curve does not', () => {
    // A peak: the monotone curve is flat on top, so nothing above 20.
    const peak = [
      { x: 0, y: 50 },
      { x: 100, y: 20 },
      { x: 200, y: 50 },
    ];
    expect(curveSpan(peak, 0, 200)).toEqual({ top: 20, bottom: 50 });
  });

  it('is nothing where the curve does not reach', () => {
    expect(curveSpan(points, 210, 300)).toBeNull();
    expect(curveSpan([], 0, 10)).toBeNull();
  });
});

describe('the word on the target line', () => {
  const base = { minTop: 18, maxTop: 90, textHeight: 16, clearance: 5 };

  it('goes under the target when the line ends above it and there is room', () => {
    expect(
      centreLabelTop({ ...base, centreY: 50, endY: 20, line: { top: 16, bottom: 30 } }),
    ).toBe(55);
  });

  it('goes over the target when the line ends below it', () => {
    expect(
      centreLabelTop({ ...base, centreY: 50, endY: 80, line: { top: 70, bottom: 86 } }),
    ).toBe(29);
  });

  it('keeps off the line when the target is the floor and the take ended on it', () => {
    // Insights' in-tune graph (the owner, 2026-09-30, "some overlap"): the
    // target 110 tall at 104, no word below, and the last take in tune — the
    // line runs from 88 to 104 under the word.
    const top = centreLabelTop({
      centreY: 104,
      endY: 103,
      line: { top: 88, bottom: 107 },
      minTop: 18,
      maxTop: 94,
      textHeight: 16,
      clearance: 5,
    });
    expect(top + 16 + 5).toBeLessThanOrEqual(88);
    expect(top).toBeGreaterThanOrEqual(18);
  });

  it('never lands on the line it was placed to avoid', () => {
    const line = { top: 40, bottom: 60 };
    for (const centreY of [10, 30, 50, 70, 90]) {
      for (const endY of [0, 50, 100]) {
        const top = centreLabelTop({ ...base, centreY, endY, line });
        const clear = top + 16 + 5 <= line.top || top >= line.bottom + 5;
        const inBounds = top >= base.minTop && top <= base.maxTop;
        // Either it found a clear place, or there was none and it stayed in bounds.
        expect(inBounds).toBe(true);
        if (!clear) {
          // Only possible when no candidate fits at all.
          expect([centreY + 5, centreY - 21, line.top - 21, line.bottom + 5].some(
            (t) => t >= base.minTop && t <= base.maxTop && (t + 21 <= line.top || t >= line.bottom + 5),
          )).toBe(false);
        }
      }
    }
  });

  it('stays in bounds when nothing fits', () => {
    const top = centreLabelTop({
      ...base,
      centreY: 50,
      endY: 20,
      line: { top: 0, bottom: 110 },
    });
    expect(top).toBeGreaterThanOrEqual(18);
    expect(top).toBeLessThanOrEqual(90);
  });

  it('with no line under it, sits beside the target as before', () => {
    expect(centreLabelTop({ ...base, centreY: 50, endY: 20, line: null })).toBe(55);
    expect(centreLabelTop({ ...base, centreY: 50, endY: 80, line: null })).toBe(29);
  });
});
