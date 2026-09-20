import { describe, expect, it } from 'vitest';

import type { MetronomeMode } from '../../data/types';
import {
  METRONOME_ORDER,
  metronomeChoices,
  metronomeValueLabel,
} from './metronomeChoice';

/**
 * The list a musician picks from on the record screen, and the one condition
 * in it that can cost them a take.
 */
describe('metronomeChoices', () => {
  it('offers every mode, so none is reachable only from Profile', () => {
    // The state this replaces: the record screen toggled between `off` and
    // the last mode used, so a musician who had never chosen one could reach
    // exactly one of the four from the screen they were recording on.
    const all: MetronomeMode[] = ['off', 'visual', 'haptic', 'audio_with_headphones'];
    const offered = metronomeChoices().map((choice) => choice.mode);

    expect([...offered].sort()).toEqual([...all].sort());
    expect(offered).toEqual(METRONOME_ORDER);
  });

  it('leads with the silent option', () => {
    // The take is the point; anything audible is a compromise against it.
    expect(metronomeChoices()[0]?.mode).toBe('off');
  });

  /**
   * The one that matters. A click through a speaker reaches the microphone
   * and the analysis counts it as playing — the take is not merely noisy, it
   * is judged against onsets nobody performed.
   */
  it('names headphones in the audio option, in the label and the reason', () => {
    const audio = metronomeChoices().find((c) => c.mode === 'audio_with_headphones');

    expect(audio?.detail).toMatch(/headphone/i);
    expect(audio?.detail).toMatch(/microphone|reach/i);
  });

  it('says of each silent mode that it is silent', () => {
    for (const mode of ['visual', 'haptic'] as const) {
      const choice = metronomeChoices().find((c) => c.mode === mode);

      expect(choice?.detail).toMatch(/silent/i);
    }
  });

  it('gives the haptic mode the condition it actually depends on', () => {
    // Haptics off in the profile silences it completely, and a metronome you
    // cannot perceive is the defect this whole control replaced.
    expect(metronomeChoices().find((c) => c.mode === 'haptic')?.detail)
      .toMatch(/profile/i);
  });

  it('labels the closed row with the value alone', () => {
    // The row's left side already says "Metronome"; repeating it on the right
    // reads as a fragment rather than a setting.
    for (const choice of metronomeChoices()) {
      expect(metronomeValueLabel(choice.mode)).toBe(choice.label);
      expect(metronomeValueLabel(choice.mode)).not.toMatch(/metronome/i);
    }
  });
});
