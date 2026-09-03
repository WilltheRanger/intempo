import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { clefSummary, meterSummary } from './scoreSummary';

const base: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'C major',
  tempo_marking: null,
  bpm_hint: 80,
  clef: 'bass',
  measures: [],
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: '',
};

const bars = (
  ...spec: { n: number; clef?: ScoreJson['clef']; metre?: string }[]
): ScoreJson['measures'] =>
  spec.map(({ n, clef, metre }) => ({
    measure_number: n,
    notes: [],
    slurs: [],
    ...(clef ? { clef } : {}),
    ...(metre ? { time_signature: metre } : {}),
  }));

describe('clefSummary', () => {
  it('names the opening clef when the piece keeps it', () => {
    expect(clefSummary({ ...base, measures: bars({ n: 1 }, { n: 2 }) })).toEqual([
      'Bass clef',
    ]);
  });

  it('says what it turns to when it turns once', () => {
    expect(
      clefSummary({ ...base, measures: bars({ n: 1 }, { n: 2, clef: 'tenor' }) }),
    ).toEqual(['Bass clef', 'turns tenor']);
  });

  it('still names the one other clef when the piece comes back', () => {
    // bass, tenor, bass. The set is what it turns *to*, so the return is not a
    // third entry and "changes" would understate a part visiting one clef.
    expect(
      clefSummary({
        ...base,
        measures: bars({ n: 1 }, { n: 2, clef: 'tenor' }, { n: 3, clef: 'bass' }),
      }),
    ).toEqual(['Bass clef', 'turns tenor']);
  });

  it('only says that it changes when it visits more than one other clef', () => {
    expect(
      clefSummary({
        ...base,
        measures: bars({ n: 1 }, { n: 2, clef: 'tenor' }, { n: 3, clef: 'treble' }),
      }),
    ).toEqual(['Bass clef', 'changes clef']);
  });

  it('never guesses a clef nothing read', () => {
    expect(clefSummary({ ...base, clef: null, measures: bars({ n: 1 }) })).toEqual([
      'Clef not read',
    ]);
  });
});

describe('meterSummary', () => {
  it('names the opening metre when the piece keeps it', () => {
    expect(meterSummary({ ...base, measures: bars({ n: 1 }, { n: 2 }) })).toEqual(['4/4']);
  });

  it('says what it turns to when it turns once', () => {
    expect(
      meterSummary({ ...base, measures: bars({ n: 1 }, { n: 2, metre: '3/4' }) }),
    ).toEqual(['4/4', 'turns 3/4']);
  });

  it('only says that it changes when it visits more than one other metre', () => {
    expect(
      meterSummary({
        ...base,
        measures: bars({ n: 1 }, { n: 2, metre: '3/4' }, { n: 3, metre: '6/8' }),
      }),
    ).toEqual(['4/4', 'changes metre']);
  });

  it('says nothing at all when the metre was not read', () => {
    // "unknown" is the escape hatch for an unreadable header, not a metre.
    expect(meterSummary({ ...base, time_signature: 'unknown' })).toEqual([]);
    expect(meterSummary({ ...base, time_signature: null })).toEqual([]);
  });
});
