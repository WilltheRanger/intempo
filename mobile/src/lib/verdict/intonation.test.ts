import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeIntonation } from '../../data/types';
import { MIN_BAR } from './measureChart';
import { pitchBand, pitchChartBars, pitchLines, pitchWords } from './intonation';

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
    expect(pitchWords(-12, TAKE)).toBe('In tune');
  });

  it('says how far and which way beyond it', () => {
    expect(pitchBand(22, TAKE)).toBe('slight');
    expect(pitchWords(22, TAKE)).toBe('22 cents sharp');
    expect(pitchBand(-41, TAKE)).toBe('off');
    expect(pitchWords(-41, TAKE)).toBe('41 cents flat');
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

describe('the lines under "In tune"', () => {
  it('names the longest stretch clearly off the same way, and nothing else', () => {
    const measures = [bar(1, 2), bar(2, -5), bar(3, 8), bar(4, -40), bar(5, -35), bar(6, 3)];

    expect(pitchLines(measures, TAKE).summary).toBe('Bars 4–5 flat');
  });

  it('says a single bar as a bar', () => {
    expect(pitchLines([bar(1, 2), bar(2, 45), bar(3, -1)], TAKE).summary).toBe('Bar 2 sharp');
  });

  it('says how the take sat when no bar was clearly off', () => {
    expect(pitchLines([bar(1, 2), bar(2, -5)], TAKE).summary).toBe('In tune throughout');
    expect(pitchLines([bar(1, 2), bar(2, 22), bar(3, 5)], TAKE).summary).toBe('Mostly in tune');
    expect(pitchLines([bar(1, 22), bar(2, -25), bar(3, 5)], TAKE).summary).toBe(
      'A little off in places',
    );
  });

  it('gives the tuning as a caption only when it is worth saying', () => {
    expect(pitchLines([bar(1, 0)], TAKE).tuning).toBe('Tuned 25¢ sharp');
    expect(pitchLines([bar(1, 0)], { ...TAKE, tuningCents: -25 }).tuning).toBe('Tuned 25¢ flat');
    expect(pitchLines([bar(1, 0)], { ...TAKE, tuningCents: 6 }).tuning).toBeNull();
  });

  it('stays short', () => {
    const lines = pitchLines([bar(1, 2), bar(2, 45), bar(3, -60), bar(4, -70)], TAKE);
    expect(lines.summary.length).toBeLessThanOrEqual(20);
    expect((lines.tuning ?? '').length).toBeLessThanOrEqual(20);
  });
});
