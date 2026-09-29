import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeResult } from '../../data/types';
import { asLabel, lastTakeByPiece, pieceStatus } from './pieceStatus';

function bar(measure: number, band: MeasureVerdict['band'], direction: MeasureVerdict['direction']) {
  return { measure, band, direction } as MeasureVerdict;
}

function take(over: Partial<TakeResult>): TakeResult {
  return {
    id: 't',
    pieceId: 'p',
    failure: null,
    lowConfidence: false,
    direction: 'rush',
    measures: [bar(1, 'on', 'on'), bar(2, 'rush_drag', 'rush'), bar(3, 'on', 'on')],
    ...over,
  } as TakeResult;
}

describe('pieceStatus', () => {
  it("says the last take in the result screen's words, without the You", () => {
    expect(pieceStatus({ lastTake: take({}) })).toBe('Rushed in the middle');
    expect(pieceStatus({ lastTake: take({ direction: 'on' }) })).toBe('Held the tempo');
  });

  it("falls back to the piece's overall word, and then to nothing", () => {
    const insight = { meanDeviationPct: -12, spreadPct: 3, tolerance: null, verdict: 'dragging' as const };
    expect(pieceStatus({ lastTake: take({ failure: 'decode' as unknown as TakeResult['failure'] }), insight })).toBe(
      'Dragged',
    );
    expect(pieceStatus({})).toBeNull();
  });
});

describe('asLabel', () => {
  it('drops the You and keeps a title that has none', () => {
    expect(asLabel('You dragged at the end')).toBe('Dragged at the end');
    expect(asLabel('Tempo drifted ahead')).toBe('Tempo drifted ahead');
  });
});

describe('lastTakeByPiece', () => {
  it('keeps the newest readable take of each piece', () => {
    const takes = [
      take({ id: 'a', pieceId: 'x', failure: 'decode' as unknown as TakeResult['failure'] }),
      take({ id: 'b', pieceId: 'x' }),
      take({ id: 'c', pieceId: 'x' }),
      take({ id: 'd', pieceId: 'y' }),
    ];
    const last = lastTakeByPiece(takes);
    expect(last.get('x')?.id).toBe('b');
    expect(last.get('y')?.id).toBe('d');
  });
});
