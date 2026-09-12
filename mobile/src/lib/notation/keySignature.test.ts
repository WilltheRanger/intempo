import { describe, expect, it } from 'vitest';

import { accidentalCount, keySignatureFor, timeSignatureDigits } from './keySignature';
import { stepOf } from './engrave';

describe('accidentalCount', () => {
  it('knows the majors', () => {
    expect(accidentalCount('C major')).toBe(0);
    expect(accidentalCount('D major')).toBe(2);
    expect(accidentalCount('E major')).toBe(4);
    expect(accidentalCount('F major')).toBe(-1);
    expect(accidentalCount('Eb major')).toBe(-3);
  });

  it('knows the minors, which are not the same as their letter in major', () => {
    // The one thing this could get quietly wrong: A minor and A major are both
    // real keys and they are seven accidentals apart.
    expect(accidentalCount('A minor')).toBe(0);
    expect(accidentalCount('A major')).toBe(3);
    expect(accidentalCount('D minor')).toBe(-1);
    expect(accidentalCount('C# minor')).toBe(4);
  });

  it('reads what a photograph actually says', () => {
    expect(accidentalCount('D Major')).toBe(2);
    expect(accidentalCount('  d   ')).toBe(2);
    expect(accidentalCount('B♭ major')).toBe(-2);
    expect(accidentalCount('d min')).toBe(-1);
    expect(accidentalCount('A m')).toBe(0);
  });

  it('reads a bare letter as major, which is the convention', () => {
    expect(accidentalCount('G')).toBe(1);
  });

  it('is null when nothing could be read, which is not the same as C major', () => {
    // A page whose header was cut off has no signature to print. Printing C
    // major's nothing is accidentally right; printing a guess is not — and the
    // caller has to be able to tell the two apart.
    expect(accidentalCount('unknown')).toBeNull();
    expect(accidentalCount(null)).toBeNull();
    expect(accidentalCount('')).toBeNull();
    expect(accidentalCount('H major')).toBeNull();
    expect(accidentalCount('Lydian')).toBeNull();
  });
});

describe('keySignatureFor', () => {
  it('prints sharps in the order F C G D A E B', () => {
    const pitches = keySignatureFor('E major', 'treble').map((a) => a.pitch);

    expect(pitches).toEqual(['F5', 'C5', 'G5', 'D5']);
    expect(keySignatureFor('E major', 'treble').every((a) => a.kind === 'sharp')).toBe(true);
  });

  it('prints flats in the order B E A D G C F', () => {
    const pitches = keySignatureFor('Ab major', 'treble').map((a) => a.pitch);

    expect(pitches).toEqual(['B4', 'E5', 'A4', 'D5']);
  });

  it('puts them where the clef puts them', () => {
    // The same key on a bass staff is not the same set of positions — it is
    // the same *letters*, two staff steps lower.
    expect(keySignatureFor('D major', 'bass').map((a) => a.pitch)).toEqual(['F3', 'C3']);
    expect(keySignatureFor('D major', 'alto').map((a) => a.pitch)).toEqual(['F4', 'C4']);
  });

  it('does not transplant alto clef\'s positions onto tenor', () => {
    // Tenor's staff sits a third below alto's, so alto's first sharp would
    // land above the top line. Both tenor rows were wrong here first time
    // round — copied from bass — and the rule below is what caught it.
    expect(keySignatureFor('G major', 'tenor')[0].pitch).toBe('F3');
    expect(keySignatureFor('G major', 'alto')[0].pitch).toBe('F4');
    expect(keySignatureFor('F major', 'tenor')[0].pitch).toBe('B3');
  });

  it('never strays more than a step off the staff, on any clef, in any key', () => {
    // **The rule the whole table has to satisfy.** A signature scattered above
    // and below the staff reads as notes rather than as a key. One step off is
    // real and printed — treble's third sharp sits in the space above the top
    // line — but nothing goes further, and a wrong octave anywhere shows up
    // here immediately.
    //
    // The staff spans four diatonic steps either side of its middle line.
    const MIDDLE = { treble: 4 * 7 + 6, bass: 3 * 7 + 1, alto: 4 * 7 + 0, tenor: 3 * 7 + 5 };
    for (const clef of ['treble', 'bass', 'alto', 'tenor'] as const) {
      for (const key of ['C# major', 'Cb major']) {
        for (const accidental of keySignatureFor(key, clef)) {
          const step = stepOf(accidental.pitch);
          expect(step).not.toBeNull();
          expect(Math.abs(step! - MIDDLE[clef])).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it('prints nothing for the three cases that print nothing', () => {
    expect(keySignatureFor('C major', 'treble')).toEqual([]);
    expect(keySignatureFor('A minor', 'treble')).toEqual([]);
    expect(keySignatureFor('unknown', 'treble')).toEqual([]);
  });
});

describe('timeSignatureDigits', () => {
  it('splits a metre', () => {
    expect(timeSignatureDigits('4/4')).toEqual({ beats: 4, unit: 4 });
    expect(timeSignatureDigits('12/8')).toEqual({ beats: 12, unit: 8 });
  });

  it('tolerates the spacing a photograph produces', () => {
    expect(timeSignatureDigits(' 3 / 4 ')).toEqual({ beats: 3, unit: 4 });
  });

  it('is null for anything that is not two numbers', () => {
    expect(timeSignatureDigits('unknown')).toBeNull();
    expect(timeSignatureDigits('C')).toBeNull();
    expect(timeSignatureDigits(null)).toBeNull();
    expect(timeSignatureDigits('4/0')).toBeNull();
  });
});
