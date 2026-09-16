import { describe, expect, it } from 'vitest';

import { passageLabel } from './passage';

/**
 * What the verdict says about which part of the page was played.
 *
 * The pipeline measures a passage rather than refusing it, which makes this the
 * ordinary case rather than an edge one: a musician working on bars 9 to 12
 * records bars 9 to 12.
 */
const bars = (...numbers: number[]) => numbers.map((measure) => ({ measure }));

describe('passageLabel', () => {
  it('names the bars when the take starts partway into the page', () => {
    expect(passageLabel(bars(9, 10, 11, 12))).toBe('Bars 9 to 12');
  });

  /**
   * "Bars 1 to 13" on a complete performance is a range with nothing to
   * contrast against, and reads as a caveat where there is none.
   */
  it('keeps the count for a take that opens the page', () => {
    expect(passageLabel(bars(1, 2, 3))).toBe('3 measures');
    expect(passageLabel(bars(1))).toBe('1 measure');
  });

  it('does not write a range for one bar', () => {
    // "Bars 9 to 9" reads as a fault in the sentence rather than a short take.
    expect(passageLabel(bars(9))).toBe('Bar 9');
  });

  it('says nothing about a take with no measures', () => {
    // Every failure state — silence, a refused alignment — arrives this way,
    // and those screens say what happened in their own words.
    expect(passageLabel([])).toBeNull();
  });

  /**
   * It never claims to know the page's length. `TakeResult` carries the
   * measures analysed and no total, so "of 24" is a sentence this cannot
   * write — and guessing it from the take is how a passage comes to be
   * reported as a whole piece.
   */
  it('never states a total it was not given', () => {
    expect(passageLabel(bars(9, 10, 11, 12))).not.toContain(' of ');
    expect(passageLabel(bars(1, 2, 3))).not.toContain(' of ');
  });
});
