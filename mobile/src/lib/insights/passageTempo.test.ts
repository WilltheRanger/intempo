import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeResult, Tolerance } from '../../data/types';
import { barsLabel, MAX_PASSAGES, passageTempo, worthALook } from './passageTempo';

const TOLERANCE: Tolerance = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 12,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 12,
  dragging_outer_pct: 20,
};

/**
 * A bar played `tempoPct` percent off a target of 100. Its drift is set to a
 * wild figure on purpose: the passages must be read from the tempo, and a
 * test that passed on either would not show which.
 */
function measure(n: number, tempoPct: number, over: Partial<MeasureVerdict> = {}): MeasureVerdict {
  const deviationPct = tempoPct;
  const band = Math.abs(deviationPct) < 5 ? 'on' : 'rush_drag';
  return {
    measure: n,
    playedBpm: 100 * (1 + tempoPct / 100),
    targetBpm: null,
    pitchCents: null,
    noteCount: 4,
    deviationPct: -300 * n,
    band,
    direction: band === 'on' ? 'on' : deviationPct > 0 ? 'rush' : 'drag',
    verdict: band === 'on' ? 'on_tempo' : deviationPct > 0 ? 'rushing' : 'dragging',
    underTempoChange: false,
    uneven: false,
    timedNoteCount: 4,
    untimedReason: null,
    ...over,
  } as MeasureVerdict;
}

function take(values: number[], over: Partial<TakeResult> = {}): TakeResult {
  return {
    id: 'take',
    pieceId: 'p1',
    failure: null,
    recordedAt: '2026-09-01T10:00:00Z',
    targetBpm: 100,
    measures: values.map((value, index) => measure(index + 1, value)),
    ...over,
  } as unknown as TakeResult;
}

describe('passageTempo', () => {
  it('splits a piece into at most eight passages of consecutive bars', () => {
    const drift = passageTempo([take(Array.from({ length: 24 }, () => 1))], 'p1', TOLERANCE);
    expect(drift?.passages).toHaveLength(MAX_PASSAGES);
    expect(drift?.passages[0]).toMatchObject({ from: 1, to: 3 });
    expect(drift?.passages[7]).toMatchObject({ from: 22, to: 24 });
  });

  it('keeps at least two bars to a passage on a short piece', () => {
    const drift = passageTempo([take([1, 1, 1, 1, 1, 1])], 'p1', TOLERANCE);
    expect(drift?.passages).toHaveLength(3);
  });

  it('says a piece that speeds up towards the end does, and offers the last passage', () => {
    const values = [0, 1, 0, 2, 1, 3, 6, 9, 12, 14, 16, 18];
    const drift = passageTempo([take(values)], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('You speed up at the end.');
    expect(drift?.practice).toMatchObject({ from: 11, to: 12 });
  });

  it('names the bars when the worst of it is in the middle', () => {
    // Four passages of two bars: the rush is the second of them.
    const values = [0, 1, 14, 16, 0, 1, 0, 1];
    const drift = passageTempo([take(values)], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('You rush most in bars 3–4.');
  });

  it('says so when every passage was on the beat, and offers nothing to fix', () => {
    const drift = passageTempo([take([1, -1, 2, 0, 1, -2])], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('Steady all the way through.');
    expect(drift?.practice).toBeNull();
  });

  it('averages the piece’s takes and ignores other pieces and failed takes', () => {
    const drift = passageTempo(
      [
        take([10, 10, 10, 10], { id: 'a' }),
        take([0, 0, 0, 0], { id: 'b', recordedAt: '2026-09-02T10:00:00Z' }),
        take([90, 90, 90, 90], { id: 'c', pieceId: 'other' }),
        take([90, 90, 90, 90], { id: 'd', failure: { kind: 'x' } as never }),
      ],
      'p1',
      TOLERANCE,
    );
    expect(drift?.passages.map((passage) => Math.round(passage.value * 1e6) / 1e6)).toEqual([5, 5]);
  });

  it('leaves out bars that were not judged', () => {
    const t = take([2, 2, 2, 2, 2]);
    t.measures[0] = measure(1, 40, { underTempoChange: true });
    const drift = passageTempo([t], 'p1', TOLERANCE);
    expect(drift?.passages[0].from).toBe(2);
    expect(drift?.passages[0].value).toBeCloseTo(2);
  });

  it('reads the tempo of each bar, not how far its notes have drifted', () => {
    // Every bar here carries a drift that grows along the take (`measure`
    // sets -300% per bar), the way a take held slow does. Read from drift,
    // the last passage is always the worst and the sentence says "You slow
    // down at the end" of a piece played at one speed. Read from tempo, the
    // piece is steady.
    const drift = passageTempo([take([0, 1, -1, 2, 0, -2, 1, 0])], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('Steady all the way through.');
  });

  it('says a piece played slow all the way through is, and offers the whole of it', () => {
    // No passage is worse than the rest, so naming one would send a musician
    // to practise bars that are no worse than any other.
    const drift = passageTempo([take([-20, -21, -19, -20, -22, -20, -21, -19])], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('Slower than your tempo all the way through.');
    expect(drift?.practice).toBeNull();
  });

  it('still names the end when it slows further than the rest', () => {
    const drift = passageTempo([take([-6, -6, -7, -6, -8, -9, -16, -22])], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('You slow down at the end.');
    expect(drift?.practice).toMatchObject({ from: 7, to: 8 });
  });

  it('draws nothing for a piece with no takes or too few bars', () => {
    expect(passageTempo([], 'p1', TOLERANCE)).toBeNull();
    expect(passageTempo([take([3, 4, 5])], 'p1', TOLERANCE)).toBeNull();
  });
});

describe('barsLabel', () => {
  it('names a passage by its bars', () => {
    expect(barsLabel({ from: 21, to: 24 })).toBe('Bars 21–24');
    expect(barsLabel({ from: 7, to: 7 })).toBe('Bar 7');
  });
});

describe('worthALook', () => {
  const piece = (pieceId: string) => ({ pieceId, tolerance: TOLERANCE });

  it('recommends the most-drifting piece whose takes can show where', () => {
    const chosen = worthALook([piece('aged'), piece('p1')], [take([0, 4, 9, 12])], null);
    expect(chosen?.piece.pieceId).toBe('p1');
    expect(chosen?.tempo).not.toBeNull();
  });

  it('falls back to the top piece, without a chart, when none can', () => {
    const chosen = worthALook([piece('aged'), piece('other')], [], null);
    expect(chosen).toEqual({ piece: piece('aged'), tempo: null });
  });

  it('recommends nothing with no pieces', () => {
    expect(worthALook([], [], null)).toBeNull();
  });
});
