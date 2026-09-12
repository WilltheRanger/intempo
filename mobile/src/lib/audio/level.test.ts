import { describe, expect, it } from 'vitest';

import { capturedNothing, createPeakMeter } from './level';

/** A chunk whose loudest sample is `peak`, with quieter ones around it. */
function chunkPeaking(peak: number): Int16Array {
  return Int16Array.from([0, Math.round(peak / 3), peak, Math.round(peak / 2), 0]);
}

describe('createPeakMeter', () => {
  it('reports nothing before anything is observed', () => {
    expect(createPeakMeter().peak()).toBe(0);
  });

  it('keeps the loudest sample across chunks, not the latest', () => {
    const meter = createPeakMeter();
    meter.observe(chunkPeaking(16384));
    meter.observe(chunkPeaking(100));

    expect(meter.peak()).toBeCloseTo(0.5, 5);
  });

  it('measures magnitude, so a take that only ever goes negative is heard', () => {
    // A DC-coupled input, or simply a waveform whose first half-cycle is down.
    // Comparing signed values would call this silence.
    const meter = createPeakMeter();
    meter.observe(Int16Array.from([0, -20000, -1, 0]));

    expect(meter.peak()).toBeGreaterThan(0.6);
  });

  it('reads full scale as 1, at both ends', () => {
    const positive = createPeakMeter();
    positive.observe(Int16Array.from([32767]));
    expect(positive.peak()).toBeCloseTo(1, 3);

    const negative = createPeakMeter();
    negative.observe(Int16Array.from([-32768]));
    expect(negative.peak()).toBe(1);
  });

  it('forgets a discarded take, so its audio cannot vouch for the next one', () => {
    // `discardCapturedSoFar` drops the samples when a take is restarted. A peak
    // left behind would let the abandoned take answer for the new one, which is
    // exactly backwards: the restart is often *because* something was wrong
    // with the input.
    const meter = createPeakMeter();
    meter.observe(chunkPeaking(30000));
    meter.reset();

    expect(meter.peak()).toBe(0);
    expect(capturedNothing(meter.peak())).toBe(true);
  });
});

describe('capturedNothing', () => {
  it('is true only for exact silence', () => {
    expect(capturedNothing(0)).toBe(true);
  });

  /**
   * The measured reason this threshold is zero and not a level.
   *
   * The onset detector is amplitude-invariant — the same notes are found at
   * -90 dBFS as at 0 — so a take at the bottom of 16-bit resolution analyses
   * exactly as well as a loud one. Refusing it would take away a verdict the
   * musician could have had, over a problem that does not exist.
   */
  it('accepts a take of one single bit, because the pipeline can read it', () => {
    const meter = createPeakMeter();
    meter.observe(Int16Array.from([0, 0, 1, 0]));

    expect(meter.peak()).toBeGreaterThan(0);
    expect(capturedNothing(meter.peak())).toBe(false);
  });

  it('is true for a long take of nothing but zeros', () => {
    const meter = createPeakMeter();
    for (let i = 0; i < 200; i += 1) {
      meter.observe(new Int16Array(4096));
    }

    expect(capturedNothing(meter.peak())).toBe(true);
  });
});
