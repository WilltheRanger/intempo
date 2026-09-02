import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import {
  CLEF_CHOICES,
  applyClefEdit,
  clefBeforeMeasure,
  describeClef,
} from './clefEdit';

const score: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'C major',
  tempo_marking: null,
  bpm_hint: 80,
  clef: 'bass',
  measures: [
    { measure_number: 1, notes: [], slurs: [] },
    { measure_number: 5, clef: 'tenor', notes: [], slurs: [] },
    { measure_number: 9, clef: 'bass', notes: [], slurs: [] },
  ],
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: '',
};

describe('the clef choices', () => {
  it('offers the four a string player meets, once each', () => {
    expect(CLEF_CHOICES.map((c) => c.value)).toEqual(['treble', 'alto', 'tenor', 'bass']);
  });

  it('never captions an unread clef as a clef', () => {
    expect(describeClef(null)).toBe('Clef not read');
    expect(describeClef('tenor')).toBe('Tenor clef');
  });
});

describe('the clef in force before a bar', () => {
  it('starts with the clef the page opens in', () => {
    expect(clefBeforeMeasure(score, 1)).toBe('bass');
    expect(clefBeforeMeasure(score, 4)).toBe('bass');
  });

  it('carries each printed change until the next one', () => {
    expect(clefBeforeMeasure(score, 5)).toBe('bass');
    expect(clefBeforeMeasure(score, 8)).toBe('tenor');
    expect(clefBeforeMeasure(score, 12)).toBe('bass');
  });
});

describe('saving a clef correction', () => {
  it('edits the score header from the opening bar', () => {
    const corrected = applyClefEdit(score, 1, 'treble');

    expect(corrected.clef).toBe('treble');
    expect(corrected.measures[0].clef).toBeNull();
  });

  it('adds or replaces a change on a later bar', () => {
    expect(applyClefEdit(score, 5, 'alto').measures[1].clef).toBe('alto');
  });

  it('removes a false change without touching any other bar', () => {
    const corrected = applyClefEdit(score, 5, null);

    expect(corrected.measures[1].clef).toBeNull();
    expect(corrected.measures[2].clef).toBe('bass');
  });

  it('records no change when the chosen clef is the one already in force', () => {
    /*
      A clef written where the page prints none is worse than the key version
      of the same mistake: a key misspells the notes its signature touches, a
      clef moves every note on the staff.
    */
    expect(clefBeforeMeasure(score, 9)).toBe('tenor');
    expect(applyClefEdit(score, 9, 'tenor').measures[2].clef).toBeNull();
  });

  it('clears a clef stamped on the opening bar, so the header edit is not a no-op', () => {
    const stamped: ScoreJson = {
      ...score,
      measures: [{ ...score.measures[0], clef: 'treble' }, ...score.measures.slice(1)],
    };

    const corrected = applyClefEdit(stamped, 1, 'alto');

    expect(corrected.clef).toBe('alto');
    expect(corrected.measures[0].clef).toBeNull();
    expect(clefBeforeMeasure(corrected, 2)).toBe('alto');
    // Later changes are untouched.
    expect(corrected.measures[1].clef).toBe('tenor');
  });
});
