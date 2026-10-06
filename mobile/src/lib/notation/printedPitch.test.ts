import { describe, expect, it } from 'vitest';

import { printedPitch } from './printedPitch';

describe('a pitch the way a page prints it', () => {
  it('draws sharps and flats as signs, keeping the octave', () => {
    expect(printedPitch('F#4')).toBe('F♯4');
    expect(printedPitch('Eb3')).toBe('E♭3');
    expect(printedPitch('C4')).toBe('C4');
  });

  it('draws doubles as one sign, not a sign and a letter', () => {
    // The bar editor's own rule gave "F♯#5" and "B♭b2".
    expect(printedPitch('F##5')).toBe('F𝄪5');
    expect(printedPitch('Fx5')).toBe('F𝄪5');
    expect(printedPitch('Bbb2')).toBe('B𝄫2');
  });

  it('works without an octave, as the verdict names notes', () => {
    expect(printedPitch('F#')).toBe('F♯');
    expect(printedPitch('Bb')).toBe('B♭');
    expect(printedPitch('B')).toBe('B');
  });

  it('leaves what is not a pitch alone', () => {
    expect(printedPitch('rest')).toBe('rest');
    expect(printedPitch('H3')).toBe('H3');
    expect(printedPitch('')).toBe('');
  });
});
