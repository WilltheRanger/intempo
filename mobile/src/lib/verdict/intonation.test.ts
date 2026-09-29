import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeIntonation } from '../../data/types';
import { MIN_BAR } from './measureChart';
import { pitchBand, pitchChartBars, pitchWord } from './intonation';

const TAKE: TakeIntonation = {
  tuningCents: 25,
  spreadCents: 14,
  notes: 60,
  inTuneCents: 15,
  slightCents: 30,
  tuningWorthSayingCents: 10,
};

function bar(measure: number, pitchCents: number | null): MeasureVerdict {
  return {
    measure,
    playedBpm: null,
    pitchCents,
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
  };
}

describe('a bar in words', () => {
  it('is in tune within the take’s own band', () => {
    expect(pitchBand(-12, TAKE)).toBe('in_tune');
    expect(pitchWord(-12, TAKE)).toBe('In tune');
  });

  it('says which way beyond it, without cents', () => {
    expect(pitchWord(22, TAKE)).toBe('Played a little sharp');
    expect(pitchWord(-22, TAKE)).toBe('Played a little flat');
    expect(pitchWord(-41, TAKE)).toBe('Played flat');
    expect(pitchWord(60, TAKE)).toBe('Played sharp');
  });
});

describe('the chart', () => {
  it('draws sharp up and flat down, scaled to 50 cents', () => {
    const bars = pitchChartBars([bar(1, 25), bar(2, -50), bar(3, 80)], TAKE)!;

    expect(bars[0]).toMatchObject({ up: true, size: 0.5, tone: 'verdictMid' });
    expect(bars[1]).toMatchObject({ up: false, size: 1, tone: 'verdictBad' });
    // Past the scale: drawn at the edge, not off it.
    expect(bars[2].size).toBe(1);
  });

  it('draws a bar nothing could be read in as a neutral stub', () => {
    const bars = pitchChartBars([bar(1, 5), bar(2, null)], TAKE)!;

    expect(bars[1]).toEqual({ measure: 2, up: true, size: MIN_BAR, tone: null });
  });

  it('is left out for a take with no pitch', () => {
    expect(pitchChartBars([bar(1, 5)], null)).toBeNull();
    expect(pitchChartBars([bar(1, null), bar(2, null)], TAKE)).toBeNull();
  });
});
