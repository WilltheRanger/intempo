import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeResult, Tolerance } from '../../data/types';
import { barsLabel, MAX_PASSAGES, passageDrift, worthALook } from './passageDrift';

const TOLERANCE: Tolerance = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 12,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 12,
  dragging_outer_pct: 20,
};

function measure(n: number, deviationPct: number, over: Partial<MeasureVerdict> = {}): MeasureVerdict {
  const band = Math.abs(deviationPct) < 5 ? 'on' : 'rush_drag';
  return {
    measure: n,
    noteCount: 4,
    deviationPct,
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
    measures: values.map((value, index) => measure(index + 1, value)),
    ...over,
  } as unknown as TakeResult;
}

describe('passageDrift', () => {
  it('splits a piece into at most eight passages of consecutive bars', () => {
    const drift = passageDrift([take(Array.from({ length: 24 }, () => 1))], 'p1', TOLERANCE);
    expect(drift?.passages).toHaveLength(MAX_PASSAGES);
    expect(drift?.passages[0]).toMatchObject({ from: 1, to: 3 });
    expect(drift?.passages[7]).toMatchObject({ from: 22, to: 24 });
  });

  it('keeps at least two bars to a passage on a short piece', () => {
    const drift = passageDrift([take([1, 1, 1, 1, 1, 1])], 'p1', TOLERANCE);
    expect(drift?.passages).toHaveLength(3);
  });

  it('says a piece that speeds up towards the end does, and offers the last passage', () => {
    const values = [0, 1, 0, 2, 1, 3, 6, 9, 12, 14, 16, 18];
    const drift = passageDrift([take(values)], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('You speed up at the end.');
    expect(drift?.practice).toMatchObject({ from: 11, to: 12 });
  });

  it('names the bars when the worst of it is in the middle', () => {
    // Four passages of two bars: the rush is the second of them.
    const values = [0, 1, 14, 16, 0, 1, 0, 1];
    const drift = passageDrift([take(values)], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('You rush most in bars 3–4.');
  });

  it('says so when every passage was on the beat, and offers nothing to fix', () => {
    const drift = passageDrift([take([1, -1, 2, 0, 1, -2])], 'p1', TOLERANCE);
    expect(drift?.sentence).toBe('Steady all the way through.');
    expect(drift?.practice).toBeNull();
  });

  it('averages the piece’s takes and ignores other pieces and failed takes', () => {
    const drift = passageDrift(
      [
        take([10, 10, 10, 10], { id: 'a' }),
        take([0, 0, 0, 0], { id: 'b', recordedAt: '2026-09-02T10:00:00Z' }),
        take([90, 90, 90, 90], { id: 'c', pieceId: 'other' }),
        take([90, 90, 90, 90], { id: 'd', failure: { kind: 'x' } as never }),
      ],
      'p1',
      TOLERANCE,
    );
    expect(drift?.passages.map((passage) => passage.value)).toEqual([5, 5]);
  });

  it('leaves out bars that were not judged', () => {
    const t = take([2, 2, 2, 2, 2]);
    t.measures[0] = measure(1, 40, { underTempoChange: true });
    const drift = passageDrift([t], 'p1', TOLERANCE);
    expect(drift?.passages[0]).toMatchObject({ from: 2, value: 2 });
  });

  it('draws nothing for a piece with no takes or too few bars', () => {
    expect(passageDrift([], 'p1', TOLERANCE)).toBeNull();
    expect(passageDrift([take([3, 4, 5])], 'p1', TOLERANCE)).toBeNull();
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
    expect(chosen?.drift).not.toBeNull();
  });

  it('falls back to the top piece, without a chart, when none can', () => {
    const chosen = worthALook([piece('aged'), piece('other')], [], null);
    expect(chosen).toEqual({ piece: piece('aged'), drift: null });
  });

  it('recommends nothing with no pieces', () => {
    expect(worthALook([], [], null)).toBeNull();
  });
});
