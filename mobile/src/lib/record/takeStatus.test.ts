import { describe, expect, it } from 'vitest';

import { takeStatus } from './takeStatus';

/**
 * The rule that keeps the take bar in a musician's language, and keeps it
 * quiet about level.
 */
describe('takeStatus', () => {
  it('says nothing when the microphone is not open', () => {
    expect(takeStatus(false, false)).toEqual({ line: null, wrong: false });
    // Even if a stale signal flag is still set — not capturing is not capturing.
    expect(takeStatus(false, true)).toEqual({ line: null, wrong: false });
  });

  it('confirms sound in words a player uses, not a stream reading', () => {
    const { line, wrong } = takeStatus(true, true);

    expect(line).toBe('Hearing you');
    expect(wrong).toBe(false);
    // The sentence this replaced. A colon and a device name is a log line.
    expect(line).not.toMatch(/microphone:/i);
  });

  it('names silence as silence and offers the check that fits it', () => {
    const { line, wrong } = takeStatus(true, false);

    expect(wrong).toBe(true);
    expect(line).toMatch(/no sound/i);
    expect(line).toMatch(/cover/i);
  });

  /**
   * The rule with the measurement behind it. `onset_strength` differences a
   * dB-scaled mel spectrogram, so the detector reads a take identically from
   * 0 dBFS to -90 (`TUNING_LOG.md`, 2026-09-02). A screen that asks a musician
   * to play up is asking for nothing and risks talking them out of a verdict.
   */
  it('never comments on how loud the playing is', () => {
    for (const hasSound of [true, false]) {
      const line = takeStatus(true, hasSound).line ?? '';

      expect(line).not.toMatch(/loud|louder|quiet|quieter|volume|level|closer/i);
    }
  });
});
