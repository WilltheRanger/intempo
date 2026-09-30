import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeResult } from '../../data/types';
import { passagePct, repeatedPassage, rowTempo, takesTrend } from './takesTrend';

function bar(measure: number, playedBpm: number | null): MeasureVerdict {
  return {
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
  };
}

/** A take at 96 whose bars 5–8 went at `fast`, the rest on tempo. */
function take(id: string, fast: number, headline = `Bars 5–8 went at ${fast}.`): TakeResult {
  return {
    id,
    failure: null,
    status: 'ok',
    lowConfidence: false,
    headline,
    targetBpm: 96,
    tempoBeatUnit: 'quarter',
    tolerance: null,
    measures: Array.from({ length: 10 }, (_, i) => bar(i + 1, i >= 4 && i <= 7 ? fast : 96)),
  } as unknown as TakeResult;
}

describe('repeatedPassage', () => {
  it('is the bars two or more verdicts open on', () => {
    expect(repeatedPassage([take('a', 104), take('b', 102)])).toEqual({ from: 5, to: 8 });
  });

  it('is null when no passage repeats', () => {
    expect(repeatedPassage([take('a', 104), take('b', 96, 'Steady all the way through.')])).toBeNull();
  });
});

describe('takesTrend', () => {
  // Newest first, as the history arrives: getting faster.
  const takes = [take('c', 108), take('b', 102), take('a', 98)];
  const trend = takesTrend(takes)!;

  it('follows the passage, oldest first, in percent of the tempo', () => {
    expect(trend.passage).toEqual({ from: 5, to: 8 });
    expect(trend.title).toBe('Bars 5–8, take by take');
    expect(trend.data.runs[0].map((p) => Math.round(p.value))).toEqual([2, 6, 13]);
    expect(trend.target).toBe(96);
  });

  it('says which way it went', () => {
    expect(trend.finding).toBe('Bars 5–8 have been getting faster.');
    expect(takesTrend([take('b', 97), take('a', 106)])!.finding).toBe(
      'Bars 5–8 are getting closer to your tempo.',
    );
  });

  it('says nothing when it has not moved', () => {
    expect(takesTrend([take('b', 104), take('a', 104)])!.finding).toBeNull();
  });

  it('is null with fewer than two takes to join', () => {
    expect(takesTrend([take('a', 104)])).toBeNull();
  });
});

describe('rowTempo', () => {
  it("is the passage's tempo in that take", () => {
    expect(rowTempo(take('a', 104), { from: 5, to: 8 })).toBe(104);
    expect(passagePct(take('a', 104), { from: 5, to: 8 })).toBeCloseTo(8.33, 1);
  });

  it('is nothing for a take with no reading', () => {
    expect(rowTempo({ ...take('a', 104), status: 'not_played' } as TakeResult, null)).toBeNull();
  });
});
