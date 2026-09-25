import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, Tolerance } from '../../data/types';
import {
  appVerdictForBar,
  barTarget,
  barTempo,
  tempoChartBars,
  tempoLine,
  tempoLineLabel,
  tempoScale,
  tempoY,
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

describe('tempoLine', () => {
  it('fits the take, target included, so nothing sits on the floor', () => {
    const line = tempoLine(OWNER, 104, 'quarter')!;

    const points = line.runs.flat();
    expect(points).toHaveLength(15);
    for (const point of points) {
      const y = tempoY(point.bpm, line, 100);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }
    expect(line.min).toBeLessThan(79.8);
    expect(line.max).toBeGreaterThan(106.2);
  });

  it('labels the target, and the ends where they do not crowd it', () => {
    const line = tempoLine(OWNER, 104, 'quarter')!;

    expect(line.ticks.map((t) => t.label)).toEqual(['104', '80']);
    expect(line.ticks.find((t) => t.isTarget)!.bpm).toBe(104);
  });

  it('breaks the line at a bar with no tempo', () => {
    const line = tempoLine([bar(1, 100), bar(2, 98), bar(3, null), bar(4, 90), bar(5, 92)], 104, 'quarter')!;

    expect(line.runs.map((run) => run.map((p) => p.measure))).toEqual([
      [1, 2],
      [4, 5],
    ]);
  });

  it('is null with fewer than two points', () => {
    expect(tempoLine([bar(1, 100)], 104, 'quarter')).toBeNull();
    expect(tempoLine([bar(1, null), bar(2, null)], 104, 'quarter')).toBeNull();
  });
});

describe('tempoScale', () => {
  const at = (bpm: number, unit: 'quarter' | 'half' = 'quarter') =>
    tempoScale(barTempo(bar(24, bpm), 104, unit, TOLERANCE)!, TOLERANCE);

  it('puts the target in the middle and a slower bar to its left', () => {
    // The owner's bar 24: 87 against 104 is 16% under, of a 20% outer band.
    const scale = at(86.6);

    expect(scale.at).toBeCloseTo(0.5 - 0.84 / 2, 2);
    expect(scale.from).toBe(scale.at);
    expect(scale.to).toBe(0.5);
    expect(scale.playedLabel).toBe('87');
    expect(scale.targetLabel).toBe('104');
    expect(scale.tone).toBe(barTempo(bar(24, 86.6), 104, 'quarter', TOLERANCE)!.tone);
  });

  it('puts a faster bar to the right', () => {
    const scale = at(114);

    expect(scale.at).toBeGreaterThan(0.5);
    expect(scale.from).toBe(0.5);
    expect(scale.to).toBe(scale.at);
  });

  it('pins a bar past the outer band to the end', () => {
    const scale = at(70);

    expect(scale.at).toBe(0);
    expect(scale.pinned).toBe(true);
    expect(scale.playedLabel).toBe('70');
  });

  it('keeps one label where the two would print over each other', () => {
    const scale = at(103);

    expect(scale.playedLabel).toBeNull();
    expect(scale.targetLabel).toBe('104');
  });

  it("labels in the page's beat unit", () => {
    const scale = at(80, 'half');

    expect(scale.targetLabel).toBe('52');
    expect(scale.playedLabel).toBe('40');
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

  it('draws the target as steps, changing between the bars', () => {
    const line = tempoLine(STEPPED, 104, 'quarter')!;

    expect(line.steps.map((s) => s.bpm)).toEqual([104, 88, 104]);
    expect(line.steps[0]).toMatchObject({ from: 0, to: 0.375 });
    expect(line.steps[1]).toMatchObject({ from: 0.375, to: 0.875 });
    expect(line.steps[2]).toMatchObject({ from: 0.875, to: 1 });
  });

  it('labels every target, and a piece that never changes has one step', () => {
    expect(tempoLine(STEPPED, 104, 'quarter')!.ticks.filter((t) => t.isTarget).map((t) => t.bpm)).toEqual([
      104, 88,
    ]);
    expect(tempoLine(OWNER, 104, 'quarter')!.steps).toEqual([{ from: 0, to: 1, bpm: 104 }]);
  });

  it('says each target in turn', () => {
    expect(tempoLineLabel(STEPPED, 104, 'quarter')).toBe(
      'Tempo by bar, against 104 BPM, then 88 from bar 3, then 104 from bar 5',
    );
    expect(tempoLineLabel(OWNER, 104, 'quarter')).toBe('Tempo by bar, against your 104 BPM');
  });
});
