import { describe, expect, it } from 'vitest';

import type { MetronomeMode } from '../../data/types';
import {
  HEADPHONES_WARNING,
  METRONOME_ORDER,
  metronomeChoices,
  metronomeValueLabel,
} from './metronomeChoice';
import { speakerBleed } from './preflight';

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
   * and the analysis counts it as playing. The picker no longer says so under
   * the option (the owner, 2026-09-30), so the warning that fires whenever the
   * mode is on is what carries it — held here, beside the list it used to live
   * in, so removing that too fails where the reason is written.
   */
  it('leaves the audio risk to the pre-flight warning, which still fires', () => {
    const check = speakerBleed('audio_with_headphones');

    expect(check.tone).toBe('warn');
    expect(check.detail).toMatch(/headphone/i);
    for (const mode of ['off', 'visual', 'haptic'] as const) {
      expect(speakerBleed(mode).tone).toBe('ok');
    }
  });

  it('has one sentence for the audio risk, and it names headphones', () => {
    expect(HEADPHONES_WARNING).toMatch(/headphone/i);
    expect(HEADPHONES_WARNING).toMatch(/recording/i);
  });

  it('offers labels alone, with no line under any of them', () => {
    for (const choice of metronomeChoices()) {
      expect(Object.keys(choice).sort()).toEqual(['label', 'mode']);
    }
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
