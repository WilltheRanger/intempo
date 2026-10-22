import { describe, expect, it } from 'vitest';

import type { MeasureVerdict } from '../../data/types';
import {
  barIndexAt,
  measureChartBars,
  MIN_BAR,
} from './measureChart';

function measure(over: Partial<MeasureVerdict> = {}): MeasureVerdict {
  return {
    measure: 1,
    noteCount: 4,
    deviationPct: 0,
    band: 'on',
    direction: 'on',
    verdict: 'on_tempo',
    underTempoChange: false,
    uneven: false,
    timedNoteCount: 4,
    untimedReason: null,
    playedBpm: null,
    pitchCents: null,
    targetBpm: null,
    ...over,
  };
}

const TAKE = [
  measure({ measure: 1, deviationPct: 2 }),
  measure({ measure: 2, deviationPct: -3 }),
  measure({ measure: 3, deviationPct: 12, band: 'slight', direction: 'rush', verdict: 'slight_rush' }),
  measure({ measure: 4, deviationPct: 24, band: 'rush_drag', direction: 'rush', verdict: 'rushing' }),
  measure({ measure: 5, deviationPct: -20, band: 'rush_drag', direction: 'drag', verdict: 'dragging' }),
];

describe('measureChartBars', () => {
  it('points ahead up and behind down', () => {
    const bars = measureChartBars(TAKE);
    expect(bars.map((b) => b.up)).toEqual([true, false, true, true, false]);
  });

  it('scales to the take’s largest deviation', () => {
    const bars = measureChartBars(TAKE);
    expect(bars[3].size).toBe(1);
    expect(bars[4].size).toBeCloseTo(20 / 24);
  });

  it('never draws a steady take’s whisker as a full-height wall', () => {
    const bars = measureChartBars([measure({ deviationPct: 1 }), measure({ measure: 2, deviationPct: -2 })]);
    expect(Math.max(...bars.map((b) => b.size))).toBeLessThan(0.25);
  });

  it('keeps on-the-beat bars visible', () => {
    expect(measureChartBars([measure({ deviationPct: 0 })])[0].size).toBe(MIN_BAR);
  });

  it('colours by what each measure was told', () => {
    const tones = measureChartBars(TAKE).map((b) => b.tone);
    expect(tones[0]).toBe('verdictOn');
    expect(tones[3]).not.toBe('verdictOn');
  });

  it('draws a measure that was not judged as a neutral stub, whatever its deviation', () => {
    const [bar] = measureChartBars([measure({ underTempoChange: true, deviationPct: 40 })]);
    expect(bar).toEqual({ measure: 1, up: true, size: MIN_BAR, tone: null });
  });

  it('does not let an unjudged measure set the scale', () => {
    const bars = measureChartBars([
      measure({ measure: 1, deviationPct: 20, band: 'rush_drag', direction: 'rush', verdict: 'rushing' }),
      measure({ measure: 2, underTempoChange: true, deviationPct: 80 }),
    ]);
    expect(bars[0].size).toBe(1);
  });
});

describe('barIndexAt', () => {
  it('finds the bar under the finger and clamps at the ends', () => {
    expect(barIndexAt(0, 300, 10)).toBe(0);
    expect(barIndexAt(155, 300, 10)).toBe(5);
    expect(barIndexAt(400, 300, 10)).toBe(9);
    expect(barIndexAt(-5, 300, 10)).toBe(0);
  });

  it('answers null before the chart has a size', () => {
    expect(barIndexAt(10, 0, 10)).toBeNull();
    expect(barIndexAt(10, 300, 0)).toBeNull();
  });
});
