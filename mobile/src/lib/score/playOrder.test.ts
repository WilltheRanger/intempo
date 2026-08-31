import { describe, expect, it } from 'vitest';

import type { ScoreJson, ScoreRepeat } from '../../data/types';
import { measuresInPlayOrder } from './playOrder';

function scoreWith(repeats: ScoreRepeat[], bars = 4): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: 60,
    repeats,
    ocr_confidence: 1,
    notes_to_human: '',
    measures: Array.from({ length: bars }, (_, index) => ({
      measure_number: index + 1,
      slurs: [],
      notes: [
        {
          pitch: 'C3',
          duration: 'whole',
          tied_to_next: false,
        },
      ],
    })),
  };
}

function played(score: ScoreJson): number[] {
  return measuresInPlayOrder(score).map((measure) => measure.measure_number);
}

describe('measuresInPlayOrder', () => {
  it('plays a plain repeated section twice', () => {
    expect(
      played(
        scoreWith([
          { start_measure: 1, end_measure: 2, type: 'repeat' },
        ]),
      ),
    ).toEqual([1, 2, 1, 2, 3, 4]);
  });

  it('takes first and second endings on their respective passes', () => {
    expect(
      played(
        scoreWith([
          { start_measure: 1, end_measure: 3, type: 'repeat' },
          { start_measure: 3, end_measure: 3, type: 'first_ending' },
          { start_measure: 4, end_measure: 4, type: 'second_ending' },
        ]),
      ),
    ).toEqual([1, 2, 3, 1, 2, 4]);
  });

  it('expands nested repeats from the widest section inward', () => {
    expect(
      played(
        scoreWith(
          [
            { start_measure: 1, end_measure: 4, type: 'repeat' },
            { start_measure: 1, end_measure: 2, type: 'repeat' },
          ],
          5,
        ),
      ),
    ).toEqual([1, 2, 1, 2, 3, 4, 1, 2, 1, 2, 3, 4, 5]);
  });

  it('ignores invalid and backwards repeat references', () => {
    const expected = [1, 2, 3, 4];
    expect(
      played(
        scoreWith([
          { start_measure: 1, end_measure: 9, type: 'repeat' },
          { start_measure: 4, end_measure: 2, type: 'repeat' },
        ]),
      ),
    ).toEqual(expected);
  });

  it('leaves a score with no repeats unchanged', () => {
    expect(played(scoreWith([]))).toEqual([1, 2, 3, 4]);
  });
});
