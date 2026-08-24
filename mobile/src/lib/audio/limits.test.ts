import { describe, expect, it } from 'vitest';

import {
  MAX_TAKE_SECONDS,
  MAX_UPLOAD_BYTES,
  maxTakeSamples,
} from './types';

/**
 * Two limits that exist for different reasons, and the smaller one was not
 * being applied.
 *
 * The recorder capped a take at fifteen minutes, which is the point where a
 * phone's memory is at risk. The `audio-uploads` bucket refuses anything over
 * 50 MB, and uncompressed audio reaches that in **nine minutes**. So the app
 * would let a musician record twelve, stop, wait through the upload, and be
 * refused — after the playing, which is the one part that cannot be repeated.
 */
describe('how long a take may be', () => {
  const CHANNELS = 1;
  const BYTES_PER_SAMPLE = 2;

  function fileBytes(sampleRate: number): number {
    return maxTakeSamples(sampleRate, CHANNELS) * BYTES_PER_SAMPLE + 44;
  }

  it.each([44100, 48000])('produces a file the bucket accepts at %i Hz', (rate) => {
    expect(fileBytes(rate)).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
  });

  it('is the upload limit that binds, not the memory one', () => {
    // If this ever flips, the comment on MAX_TAKE_SECONDS is wrong and someone
    // should find out from a failing test rather than from a refused upload.
    const byMemory = 48000 * CHANNELS * MAX_TAKE_SECONDS;
    expect(maxTakeSamples(48000, CHANNELS)).toBeLessThan(byMemory);
  });

  it('gives a slower device longer, because the limit is bytes', () => {
    // A phone that insists on 44.1 kHz fits nearly a minute more of music into
    // the same file. A constant in seconds could only be right for one rate.
    expect(maxTakeSamples(44100, CHANNELS) / 44100).toBeGreaterThan(
      maxTakeSamples(48000, CHANNELS) / 48000,
    );
  });

  it('still leaves far more room than a real take needs', () => {
    // The point is not to be generous, it is not to lose a take. Nine minutes
    // is well past any passage someone means to submit.
    expect(maxTakeSamples(48000, CHANNELS) / 48000).toBeGreaterThan(8 * 60);
  });

  it('never returns a cap of zero', () => {
    // A nonsense sample rate must not produce a recorder that stops instantly.
    expect(maxTakeSamples(0, 1)).toBeGreaterThan(0);
    expect(maxTakeSamples(48000, 0)).toBeGreaterThan(0);
  });

  it('scales with channel count', () => {
    // Stereo is not used today. If it ever is, the memory side has to halve.
    expect(maxTakeSamples(48000, 2)).toBeLessThanOrEqual(
      maxTakeSamples(48000, 1),
    );
  });
});
