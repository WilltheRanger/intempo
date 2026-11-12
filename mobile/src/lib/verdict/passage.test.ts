import { describe, expect, it } from 'vitest';

import { headlinePassage, practiceLabel, practicePassage, practicingLine } from './passage';

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

describe('practicePassage', () => {
  const take = (over: Partial<{ headline: string | null; lowConfidence: boolean; failure: unknown }>) => ({
    headline: 'Bars 5–8 went at 104.',
    lowConfidence: false,
    failure: null,
    ...over,
  });

  it('is the passage the newest judged take names', () => {
    expect(practicePassage(take({}))).toEqual({ from: 5, to: 8 });
  });

  it('is nothing for a take that failed, could not be trusted, or names no bars', () => {
    expect(practicePassage(take({ failure: { recoverable: true, reason: null } }))).toBeNull();
    expect(practicePassage(take({ lowConfidence: true }))).toBeNull();
    expect(practicePassage(take({ headline: 'Steady all the way through.' }))).toBeNull();
    expect(practicePassage(null)).toBeNull();
  });
});

describe('practicingLine', () => {
  it('names the passage Record was opened for, while the take starts there', () => {
    expect(practicingLine({ startAt: 5, endAt: 8 }, 5)).toBe('Practicing bars 5–8');
    expect(practicingLine({ startAt: 12, endAt: 12 }, 12)).toBe('Practicing bar 12');
  });

  it('goes once the musician moves the start, or when no passage was named', () => {
    expect(practicingLine({ startAt: 5, endAt: 8 }, 1)).toBeNull();
    expect(practicingLine({ startAt: 5 }, 5)).toBeNull();
    expect(practicingLine({}, null)).toBeNull();
  });
});
