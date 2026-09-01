import { describe, expect, it } from 'vitest';

import { countInOutputs, metronomeRuns, takeOutputs } from './countIn';

describe('countInOutputs', () => {
  it('ticks and taps even when the metronome is off', () => {
    // **The whole point.** A count-in is not the metronome feature; it is how
    // a take starts, and starting without one means guessing the downbeat.
    expect(countInOutputs(true)).toEqual({ click: true, haptic: true });
  });

  it('respects the profile switch for haptics, and only that', () => {
    // Taps off across the app means off here. The count is still audible and
    // still on the screen, so nothing is lost that was not chosen.
    expect(countInOutputs(false)).toEqual({ click: true, haptic: false });
  });
});

describe('takeOutputs', () => {
  it('clicks during a take only when the musician said headphones', () => {
    // `alignment.py` measures every onset from the first one it detects, so a
    // click over the speaker becomes the note the take is judged against.
    // Nothing here can check for headphones; the mode is the assertion.
    expect(takeOutputs('audio_with_headphones', true).click).toBe(true);
    expect(takeOutputs('haptic', true).click).toBe(false);
    expect(takeOutputs('visual', true).click).toBe(false);
    expect(takeOutputs('off', true).click).toBe(false);
  });

  it('taps during a take only in haptic mode, and only if haptics are on', () => {
    expect(takeOutputs('haptic', true).haptic).toBe(true);
    expect(takeOutputs('haptic', false).haptic).toBe(false);
    expect(takeOutputs('audio_with_headphones', true).haptic).toBe(false);
  });

  it('differs from the count-in for every mode but the audible one', () => {
    // If these ever agree, the count-in has stopped being a count-in.
    for (const mode of ['off', 'visual', 'haptic'] as const) {
      expect(takeOutputs(mode, true)).not.toEqual(countInOutputs(true));
    }
  });
});

describe('metronomeRuns', () => {
  it('runs through a count-in with the metronome off', () => {
    expect(metronomeRuns('off', { countingIn: true, capturing: true })).toBe(true);
  });

  it('stops after the count-in when the metronome is off', () => {
    expect(metronomeRuns('off', { countingIn: false, capturing: true })).toBe(false);
  });

  it('keeps running through the take when the metronome is on', () => {
    expect(metronomeRuns('haptic', { countingIn: false, capturing: true })).toBe(true);
  });

  it('never runs when nothing is being captured', () => {
    expect(metronomeRuns('haptic', { countingIn: true, capturing: false })).toBe(false);
  });
});
