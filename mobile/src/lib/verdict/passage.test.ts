import { describe, expect, it } from 'vitest';

import { headlinePassage, practiceLabel } from './passage';

describe('headlinePassage', () => {
  it('reads the two shapes the server writes', () => {
    expect(headlinePassage('Bars 5–8 went at 104.')).toEqual({ from: 5, to: 8 });
    expect(headlinePassage('Bar 12 fell behind.')).toEqual({ from: 12, to: 12 });
    expect(headlinePassage('Bars 13–25 ran ahead. Then you rushed the end.')).toEqual({
      from: 13,
      to: 25,
    });
  });

  it('names no passage for a sentence that is not about bars', () => {
    expect(headlinePassage('Steady all the way through.')).toBeNull();
    expect(headlinePassage('')).toBeNull();
    expect(headlinePassage(null)).toBeNull();
  });

  it('does not read a number that is not at the start', () => {
    expect(headlinePassage('Most bars were steady; bar 4 ran ahead.')).toBeNull();
  });
});

describe('practiceLabel', () => {
  it('says one bar as a bar and a range as bars', () => {
    expect(practiceLabel({ from: 12, to: 12 })).toBe('Practice bar 12');
    expect(practiceLabel({ from: 5, to: 8 })).toBe('Practice bars 5–8');
  });
});
