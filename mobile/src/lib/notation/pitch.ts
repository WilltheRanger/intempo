/**
 * Scientific pitch, as a number you can compare.
 *
 * **Extracted from `score/schedule.ts` rather than retyped.** That file had the
 * semitone table and the MIDI arithmetic inside `frequencyOf`, and the next
 * thing to need "is this note below a violin's lowest string" would have had a
 * second copy of both. `format.ts` has the scar from the other choice: two
 * byte-identical page-count helpers, one of them untested.
 */

const SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const PITCH = /^([A-G])(#|b)?(-?\d+)$/;

/**
 * MIDI note number for a scientific pitch, or null for anything else.
 *
 * Null rather than a guess. A score from OCR can contain surprises, and every
 * caller here would rather do nothing than act on a number it invented.
 */
export function midiOf(pitch: string): number | null {
  const match = PITCH.exec(pitch);
  if (!match) {
    return null;
  }
  const [, letter, accidental, octave] = match;
  const semitone =
    SEMITONES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  // MIDI 69 is A4. Octave 4 starts at MIDI 60.
  return (Number(octave) + 1) * 12 + semitone;
}

/**
 * The same note name an octave up or down, keeping its spelling.
 *
 * Spelling is kept on purpose: a page that prints E flat means E flat an octave
 * up too, and respelling it D sharp would put a correction in front of a
 * musician that is right about the pitch and wrong about the page.
 */
export function shiftOctave(pitch: string, octaves: number): string | null {
  const match = PITCH.exec(pitch);
  if (!match) {
    return null;
  }
  const [, letter, accidental, octave] = match;
  const next = Number(octave) + octaves;
  if (next < -1 || next > 9) {
    return null;
  }
  return `${letter}${accidental ?? ''}${next}`;
}
