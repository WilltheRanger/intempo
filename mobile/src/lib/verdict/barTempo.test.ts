import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, Tolerance } from '../../data/types';
import {
  appVerdictForBar,
  barTarget,
  barTempo,
  tempoChartBars,
} from './barTempo';

const TOLERANCE: Tolerance = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 10,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 10,
  dragging_outer_pct: 20,
};

function bar(measure: number, playedBpm: number | null, over: Partial<MeasureVerdict> = {}) {
  const value: MeasureVerdict = {
    measure,
    playedBpm,
    pitchCents: null,
    targetBpm: null,
    noteCount: 4,
    // The pile-up the charts used to plot: huge, and always behind.
    deviationPct: -300,
    band: 'severe',
    direction: 'drag',
    verdict: 'dragging',
    underTempoChange: false,
    uneven: false,
    timedNoteCount: 4,
    untimedReason: null,
    ...over,
  };
  return value;
}

/** The owner's take of 2026-09-25, bar by bar, against 104. */
const OWNER = [
  103.9, 96.6, 102.7, 102.4, 106.2, 102.8, 86.6, 85.4, 79.8, 97.9, 100.9, 100.7,
  98.5, 83.2, 85.7,
].map((bpm, i) => bar(i + 1, bpm));

describe('barTempo', () => {
  it('reads a bar played steadily slower as its tempo, not a beat behind', () => {
    const tempo = barTempo(bar(9, 79.8), 104, 'quarter', TOLERANCE);

    expect(tempo).not.toBeNull();
    expect(tempo!.label).toBe('80 BPM');
    expect(tempo!.detail).toBe('24 under your 104');
    expect(tempo!.direction).toBe('drag');
    expect(tempo!.band).toBe('severe');
  });

  it('calls a bar within the inner band on, whatever the pile-up says', () => {
    const tempo = barTempo(bar(1, 103.9), 104, 'quarter', TOLERANCE);

    expect(tempo!.band).toBe('on');
    expect(tempo!.direction).toBe('on');
    expect(tempo!.detail).toBe('On your 104');
  });

  it('says over for a faster bar', () => {
    expect(barTempo(bar(5, 107), 104, 'quarter', TOLERANCE)!.detail).toBe(
      '3 over your 104',
    );
  });

  it('shows the figures in the beat unit the page prints', () => {
    const tempo = barTempo(bar(1, 90), 104, 'half', TOLERANCE);

    expect(tempo!.label).toBe('45 half-note BPM');
    expect(tempo!.detail).toBe('7 under your 52');
  });

  it('leaves a bar with no tempo, or one the page said not to judge, alone', () => {
    expect(barTempo(bar(1, null), 104, 'quarter', TOLERANCE)).toBeNull();
    expect(
      barTempo(bar(1, 80, { underTempoChange: true }), 104, 'quarter', TOLERANCE),
    ).toBeNull();
  });
});

describe('appVerdictForBar', () => {
  it('corrects what the card showed: the tempo', () => {
    // The pile-up said "dragging" of bar 1; the card now says on 104.
    expect(appVerdictForBar(OWNER[0], 104, 'quarter', TOLERANCE)).toBe('on_tempo');
    expect(appVerdictForBar(OWNER[8], 104, 'quarter', TOLERANCE)).toBe('dragging');
  });

  it("falls back to the bar's verdict where there is no tempo", () => {
    expect(appVerdictForBar(bar(1, null), 104, 'quarter', TOLERANCE)).toBe('dragging');
  });
});

describe('tempoChartBars', () => {
  it('draws each bar by its distance from the target', () => {
    const bars = tempoChartBars(OWNER, 104, 'quarter', TOLERANCE)!;

    expect(bars[0].tone).toBe('verdictOn');
    // Bar 9 is the furthest from 104, so it is the full half-height.
    expect(bars[8].size).toBe(1);
    expect(bars[8].up).toBe(false);
    expect(bars[4].up).toBe(true);
  });

  it('is null for an older result, so the old chart is drawn', () => {
    expect(tempoChartBars([bar(1, null), bar(2, null)], 104, 'quarter', TOLERANCE)).toBeNull();
  });
});

describe('a page that changes tempo', () => {
  // Marked 104; "meno mosso 88" from bar 3; "Tempo I" from bar 5.
  const STEPPED = [
    bar(1, 104),
    bar(2, 103),
    bar(3, 88, { targetBpm: 88 }),
    bar(4, 87, { targetBpm: 88 }),
    bar(5, 104),
  ];

  it('judges a bar against its own target', () => {
    expect(barTarget(STEPPED[2], 104)).toBe(88);
    expect(barTarget(STEPPED[0], 104)).toBe(104);

    const meno = barTempo(STEPPED[2], 104, 'quarter', TOLERANCE)!;
    expect(meno.detail).toBe('On your 88');
    expect(meno.band).toBe('on');
  });
});
