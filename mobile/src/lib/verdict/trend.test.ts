import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeIntonation, Tolerance } from '../../data/types';
import {
  barAtAlong,
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
