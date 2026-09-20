import { describe, expect, it } from 'vitest';

import { failureTitle, intakeRefusal } from './failureTitle';

/**
 * The six codes `audio_intake.py` can write. Kept as a literal list rather
 * than imported, because the point is that the app and the backend agree —
 * a shared constant would make them agree by construction and prove nothing.
 */
const CODES = [
  'audio_too_long',
  'audio_too_large',
  'audio_not_recognised',
  'audio_damaged',
  'audio_empty',
  'audio_unreadable',
];

describe('intakeRefusal', () => {
  it('answers for every code the intake guard can write', () => {
    for (const code of CODES) {
      const out = intakeRefusal(code);
      expect(out, code).not.toBeNull();
      expect(out?.title.length, code).toBeGreaterThan(0);
      expect(out?.description.length, code).toBeGreaterThan(0);
    }
  });

  it('gives each one its own words, since each has its own next move', () => {
    const titles = CODES.map((code) => intakeRefusal(code)?.title);

    expect(new Set(titles).size).toBe(CODES.length);
  });

  /**
   * **The sentence these replace.** Every non-recoverable failure used to read
   * "Your playing wasn't the problem. Record it again when you have a moment."
   * — true of a crashed worker, and actively misleading for a file that was
   * refused: the playing was never involved, and recording again does nothing
   * about a take that is ninety minutes long.
   */
  it('never tells someone to play again over a file that was refused', () => {
    for (const code of CODES) {
      const out = intakeRefusal(code);
      expect(out?.description, code).not.toMatch(/playing wasn.t the problem/i);
      expect(out?.description, code).not.toMatch(/record it again/i);
    }
  });

  it('names something to do about it, in every case', () => {
    for (const code of CODES) {
      // Each description has to end in an action rather than a diagnosis. A
      // reason a musician cannot act on is the same as no reason.
      expect(intakeRefusal(code)?.description, code).toMatch(
        /again|fit|work|pick|trim|export|check/i,
      );
    }
  });

  /**
   * A guard that only ever matches is not a guard. The pipeline's own
   * failures must keep the copy written for them.
   */
  it('is null for the pipeline’s own failures and for nothing at all', () => {
    expect(intakeRefusal('audio_unavailable')).toBeNull();
    expect(intakeRefusal('internal_error')).toBeNull();
    expect(intakeRefusal(null)).toBeNull();
    expect(intakeRefusal(undefined)).toBeNull();
    expect(intakeRefusal('')).toBeNull();
  });

  it('leaves the existing headings alone', () => {
    expect(failureTitle({ recoverable: true, reason: 'internal_error' })).toBe(
      'Something went wrong on our end',
    );
    expect(failureTitle({ recoverable: false, reason: 'audio_unavailable' })).toBe(
      'This recording couldn’t be processed',
    );
  });
});
