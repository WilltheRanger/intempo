import { describe, expect, it } from 'vitest';

import { deviationWords } from './deviationWords';

/**
 * The sentence that replaced `+18%`.
 *
 * It is read at the one moment a musician is deciding whether to play a passage
 * again, so every case here is about whether it can be acted on: a phrase that
 * is too precise invites re-reading, and one that is too vague says nothing the
 * row above it did not.
 */
describe('deviationWords', () => {
  it('speaks in shares of a beat, which is what the figure already was', () => {
    // `MeasureVerdict.deviationPct` is a percentage of one beat, so this is a
    // change of currency rather than a rescaling.
    expect(deviationWords(25, 'rush')).toBe('About a quarter of a beat ahead');
    expect(deviationWords(50, 'drag')).toBe('About half a beat behind');
    expect(deviationWords(100, 'rush')).toBe('About a whole beat ahead');
  });

  it('names the direction in the word for position, not for judgement', () => {
    // "Rushing" is a judgement and the row already carries one. This sentence
    // answers a different question about the same bar.
    expect(deviationWords(25, 'rush')).toContain('ahead');
    expect(deviationWords(25, 'drag')).toContain('behind');
    expect(deviationWords(25, 'rush')).not.toMatch(/rush|drag/i);
  });

  it('reads the same either side of the beat', () => {
    expect(deviationWords(-50, 'drag')).toBe('About half a beat behind');
  });

  /** "About a quarter of a beat ahead of the beat" says beat twice. */
  it('never says beat twice', () => {
    for (const pct of [3, 25, 50, 100, 300]) {
      const phrase = deviationWords(pct, 'rush') ?? '';
      expect(phrase.match(/beat/g) ?? []).toHaveLength(1);
    }
  });

  /**
   * Under a quarter of a beat there is nothing to name that would not be a
   * precision the pipeline does not have. "Barely" is the honest word.
   */
  it('does not invent a fraction it cannot support', () => {
    expect(deviationWords(3, 'rush')).toBe('Barely ahead of the beat');
    // Not "Barely behind of the beat", which is what one shared string gave.
    expect(deviationWords(12, 'drag')).toBe('Barely behind the beat');
  });

  /**
   * Zero is a take that landed on the beat, and the row above already says so.
   * "Barely ahead" there would be the app finding a fault in a bar it had just
   * called on tempo.
   */
  it('says nothing about a measure that was on the beat', () => {
    expect(deviationWords(0, 'rush')).toBeNull();
    expect(deviationWords(0.4, 'drag')).toBeNull();
  });

  it('stops naming fractions once they stop meaning anything', () => {
    expect(deviationWords(400, 'rush')).toBe('More than a beat ahead');
  });

  /** Each boundary, one at a time, so the table cannot drift unnoticed. */
  it.each([
    [12, 'Barely ahead of the beat'],
    [12.1, 'About a quarter of a beat ahead'],
    [37, 'About a quarter of a beat ahead'],
    [37.1, 'About half a beat ahead'],
    [70, 'About half a beat ahead'],
    [70.1, 'About a whole beat ahead'],
    [130, 'About a whole beat ahead'],
    [130.1, 'More than a beat ahead'],
  ])('%s%% reads as "%s"', (pct, words) => {
    expect(deviationWords(pct as number, 'rush')).toBe(words);
  });

  /** No digit reaches the musician. That is the whole point of the change. */
  it('contains no numerals', () => {
    for (const pct of [1, 5, 12, 25, 50, 90, 120, 200]) {
      expect(deviationWords(pct, 'rush')).not.toMatch(/\d/);
    }
  });
});
