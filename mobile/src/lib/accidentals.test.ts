import { describe, expect, it } from 'vitest';

import { hasAccidental, splitAccidentals } from './accidentals';

describe('accidentals in running text', () => {
  it('cuts out the flat in the owner’s sentence and keeps everything else', () => {
    expect(splitAccidentals('Your low B♭s run sharp')).toEqual([
      { text: 'Your low B', accidental: false },
      { text: '♭', accidental: true },
      { text: 's run sharp', accidental: false },
    ]);
  });

  it('finds sharps, naturals and the crotchet too', () => {
    for (const char of ['♯', '♮', '♩']) {
      expect(hasAccidental(`F${char}`)).toBe(true);
    }
  });

  it('keeps a double sharp or double flat whole', () => {
    // Both are two UTF-16 units. Cut in half they print as two boxes.
    expect(splitAccidentals('F\u{1D12A}')).toEqual([
      { text: 'F', accidental: false },
      { text: '\u{1D12A}', accidental: true },
    ]);
    expect(splitAccidentals('B\u{1D12B}')[1]).toEqual({ text: '\u{1D12B}', accidental: true });
  });

  it('leaves the ASCII stand-ins alone', () => {
    // "Bb" and "F#" are what a musician types; they are already in Inter.
    expect(hasAccidental('Bb major, F# minor')).toBe(false);
    expect(splitAccidentals('F#')).toEqual([{ text: 'F#', accidental: false }]);
  });

  it('loses no character and makes no empty runs', () => {
    for (const text of ['♭', 'E♭', 'E♭ and A♭', '♯♯', 'plain']) {
      const parts = splitAccidentals(text);
      expect(parts.map((p) => p.text).join('')).toBe(text);
      expect(parts.every((p) => p.text.length > 0)).toBe(true);
    }
  });
});
