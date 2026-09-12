import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { openingTimeSignature, timeSignaturesByMeasure } from './meter';

function score(): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: 80,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: [
      { measure_number: 1, notes: [], slurs: [] },
      { measure_number: 2, time_signature: '6/8', notes: [], slurs: [] },
      { measure_number: 3, notes: [], slurs: [] },
      { measure_number: 4, time_signature: '3/4', notes: [], slurs: [] },
    ],
  };
}

describe('meter in force', () => {
  it('carries each printed change until the next one', () => {
    expect([...timeSignaturesByMeasure(score()).entries()]).toEqual([
      [1, '4/4'],
      [2, '6/8'],
      [3, '6/8'],
      [4, '3/4'],
    ]);
  });

  it('uses a change printed on the first played bar for the count-in', () => {
    const entered = { ...score(), measures: score().measures.slice(1) };
    expect(openingTimeSignature(entered)).toBe('6/8');
  });

  it('falls back honestly when no meter was read', () => {
    const unknown = score();
    unknown.time_signature = null;
    unknown.measures = [{ measure_number: 1, notes: [], slurs: [] }];
    expect(openingTimeSignature(unknown)).toBeNull();
  });
});
