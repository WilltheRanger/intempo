import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import {
  KEY_SIGNATURE_CHOICES,
  applyKeySignatureEdit,
  describeKeySignature,
  keyBeforeMeasure,
  sameEditableSignature,
} from './keySignatureEdit';

const score: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'Bb major',
  tempo_marking: null,
  bpm_hint: 80,
  clef: 'bass',
  measures: [
    { measure_number: 1, notes: [], slurs: [] },
    { measure_number: 5, key_signature: 'G major', notes: [], slurs: [] },
    { measure_number: 9, key_signature: 'C major', notes: [], slurs: [] },
  ],
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: '',
};

describe('key-signature choices', () => {
  it('offers every printable signature exactly once', () => {
    expect(KEY_SIGNATURE_CHOICES).toHaveLength(15);
    expect(KEY_SIGNATURE_CHOICES.map((item) => item.value)).toEqual([
      'Cb major', 'Gb major', 'Db major', 'Ab major', 'Eb major',
      'Bb major', 'F major', 'C major', 'G major', 'D major',
      'A major', 'E major', 'B major', 'F# major', 'C# major',
    ]);
  });

  it('keeps no printed change distinct from a change to C major', () => {
    expect(sameEditableSignature(null, 'C major')).toBe(false);
    expect(sameEditableSignature('Bb major', 'G minor')).toBe(true);
  });

  it('describes relative minor by the same printed signature', () => {
    expect(describeKeySignature('G minor')).toBe(
      '2 flats · B♭ major / G minor',
    );
    expect(describeKeySignature('F# major')).toBe(
      '6 sharps · F♯ major / D♯ minor',
    );
  });
});

describe('the key in force before a bar', () => {
  it('starts with the score header', () => {
    expect(keyBeforeMeasure(score, 1)).toBe('Bb major');
    expect(keyBeforeMeasure(score, 4)).toBe('Bb major');
  });

  it('carries each printed change until the next one', () => {
    expect(keyBeforeMeasure(score, 5)).toBe('Bb major');
    expect(keyBeforeMeasure(score, 8)).toBe('G major');
    expect(keyBeforeMeasure(score, 12)).toBe('C major');
  });
});


describe('saving a key correction', () => {
  it('edits the score header from the opening bar', () => {
    const corrected = applyKeySignatureEdit(score, 1, 'D major');

    expect(corrected.key_signature).toBe('D major');
    expect(corrected.measures[0]).not.toHaveProperty('key_signature');
  });

  it('adds or replaces a change on a later bar', () => {
    const corrected = applyKeySignatureEdit(score, 5, 'Eb major');

    expect(corrected.key_signature).toBe('Bb major');
    expect(corrected.measures[1].key_signature).toBe('Eb major');
  });

  it('removes a false change without changing any other bar', () => {
    const corrected = applyKeySignatureEdit(score, 5, null);

    expect(corrected.measures[1].key_signature).toBeNull();
    expect(corrected.measures[2].key_signature).toBe('C major');
  });
});
