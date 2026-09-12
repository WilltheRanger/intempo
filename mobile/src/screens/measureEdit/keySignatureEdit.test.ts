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
    // Explicitly null rather than absent: the opening bar carries no printed
    // change, and saying so is what stops a stale one outranking the header.
    // The sibling case below asserts the same shape for a cleared change.
    expect(corrected.measures[0].key_signature).toBeNull();
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

  it('records no change when the chosen signature is the one already in force', () => {
    /*
      The sheet lists all fifteen signatures and asks which is *printed at this
      bar*; the natural way to read a list of keys is "which key is this bar
      in". On a bar that prints nothing those are different questions, and
      storing the answer to the second one puts a key change on a bar the page
      does not change at — which the engraver then draws after the barline and
      announces with a courtesy signature on the line before, warning a reader
      about a change to the key they are already in.
    */
    expect(keyBeforeMeasure(score, 9)).toBe('G major');

    const corrected = applyKeySignatureEdit(score, 9, 'G major');

    expect(corrected.measures[2].key_signature).toBeNull();
    // The relative minor prints the same marks, so it is the same non-change.
    expect(applyKeySignatureEdit(score, 9, 'E minor').measures[2].key_signature).toBeNull();
  });

  it('still records a real change to a different signature', () => {
    expect(applyKeySignatureEdit(score, 9, 'D major').measures[2].key_signature).toBe(
      'D major',
    );
  });

  it('clears a signature stamped on the opening bar, so the header edit is not a no-op', () => {
    /*
      A measure-level key outranks the header — that is what makes a change a
      change — so setting the header while leaving one on the first bar changed
      nothing at all: the musician corrected the opening key, the screen closed,
      and the score still opened in the old one. `start_from_measure` stamps the
      entry bar with the key in force, so this shape is one the app produces.
    */
    const stamped: ScoreJson = {
      ...score,
      measures: [
        { ...score.measures[0], key_signature: 'G major' },
        ...score.measures.slice(1),
      ],
    };

    const corrected = applyKeySignatureEdit(stamped, 1, 'D major');

    expect(corrected.key_signature).toBe('D major');
    expect(corrected.measures[0].key_signature).toBeNull();
    // And the correction is the key actually in force from bar 1 onward.
    expect(keyBeforeMeasure(corrected, 2)).toBe('D major');
    // Later changes are untouched.
    expect(corrected.measures[1].key_signature).toBe('G major');
  });
});
