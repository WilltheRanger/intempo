import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeIntonation, Tolerance } from '../../data/types';
import { barAtAlong, takePitchTrend, tempoTrend, trendY } from './trend';

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
    // Bar 5 was played at 112; with 104 and 106 either side it draws at 107.
    expect(trend.runs[0][4].value).toBe(107);
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
