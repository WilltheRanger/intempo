import { describe, expect, it } from 'vitest';

import { describeCapture } from './capture';

/**
 * The report stored with each take, saying what the microphone applied.
 *
 * It exists to answer one question — was this take captured raw, or through
 * the phone's voice processing? — so the thing to hold is that it never
 * answers that question on the device's behalf.
 */

describe('describeCapture', () => {
  it('records what the device reports, field for field', () => {
    const report = describeCapture(
      {
        autoGainControl: false,
        noiseSuppression: true,
        echoCancellation: false,
        sampleRate: 48000,
        channelCount: 1,
      },
      { fellBack: false },
    );
    expect(report).toEqual({
      autoGainControl: false,
      noiseSuppression: true,
      echoCancellation: false,
      sampleRate: 48000,
      channelCount: 1,
      fellBack: false,
    });
  });

  /**
   * The whole point. A browser that leaves `autoGainControl` out of
   * `getSettings()` has said nothing about it, and writing `false` would turn
   * silence into the answer this was built to find out.
   */
  it('keeps a setting the device did not report as unknown, not off', () => {
    const report = describeCapture({ sampleRate: 44100 }, { fellBack: false });
    expect(report.autoGainControl).toBeNull();
    expect(report.noiseSuppression).toBeNull();
    expect(report.echoCancellation).toBeNull();
    expect(report.channelCount).toBeNull();
    expect(report.sampleRate).toBe(44100);
  });

  it('treats a track with no getSettings as reporting nothing', () => {
    expect(describeCapture(undefined, { fellBack: true })).toEqual({
      autoGainControl: null,
      noiseSuppression: null,
      echoCancellation: null,
      sampleRate: null,
      channelCount: null,
      fellBack: true,
    });
  });

  /** Only a real boolean is a claim; a truthy string is not one. */
  it('does not read a non-boolean as a setting', () => {
    const report = describeCapture(
      { autoGainControl: 'true', noiseSuppression: 1, echoCancellation: 0 },
      { fellBack: false },
    );
    expect(report.autoGainControl).toBeNull();
    expect(report.noiseSuppression).toBeNull();
    expect(report.echoCancellation).toBeNull();
  });

  it('does not record a rate or channel count that could not be real', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '48000']) {
      const report = describeCapture(
        { sampleRate: bad, channelCount: bad },
        { fellBack: false },
      );
      expect(report.sampleRate).toBeNull();
      expect(report.channelCount).toBeNull();
    }
  });

  /**
   * The fallback is recorded whatever the settings say, because it is the one
   * route the settings cannot reveal: the request that was refused left no
   * trace on the track that replaced it.
   */
  it('carries the fallback through independently of the settings', () => {
    const raw = {
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: false,
    };
    expect(describeCapture(raw, { fellBack: true }).fellBack).toBe(true);
    expect(describeCapture(raw, { fellBack: false }).fellBack).toBe(false);
  });
});
