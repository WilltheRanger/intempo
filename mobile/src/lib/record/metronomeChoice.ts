import type { MetronomeMode } from '../../data/types';

/**
 * The four ways to mark the beat, and what each costs a musician to pick.
 *
 * **Why this exists: on the record screen the mode could not be chosen at
 * all.** The control there was a two-state toggle between `off` and whichever
 * mode was last on, so a musician who wanted a click for the first time had to
 * leave a screen with an instrument up, find the setting in Profile, choose,
 * and come back. Three of the four modes were unreachable from the one place
 * anybody wants them.
 *
 * A module rather than a list inside the screen, for the reason `CLAUDE.md`
 * §3 gives — and for one specific to this list: **`audio_with_headphones` is
 * the only option here that can ruin a take.** A click through the speaker
 * reaches the microphone as phantom onsets and the analysis counts them as
 * playing, so the mode's name carries the condition and so does its
 * description. That is a rule, and a rule in a `.tsx` is a rule nothing
 * checks.
 */

export interface MetronomeChoice {
  mode: MetronomeMode;
  /** The row's own label, in the picker and on the closed row. */
  label: string;
  /** One line under it, saying what actually happens. */
  detail: string;
}

/**
 * Every mode, in the order a musician meets them.
 *
 * Silent first, because the take is the point and anything audible is a
 * compromise against it. The typed record — rather than an array — is what
 * makes this exhaustive: adding a `MetronomeMode` without a line here stops
 * compiling, which is the failure mode a list would have shipped quietly.
 */
const CHOICES: Record<MetronomeMode, Omit<MetronomeChoice, 'mode'>> = {
  off: {
    label: 'Off',
    detail: 'Nothing marks the beat.',
  },
  visual: {
    label: 'Visual',
    detail: 'A silent pulse on screen.',
  },
  haptic: {
    label: 'Haptic',
    detail: 'A silent tap. Needs haptics on in Profile.',
  },
  audio_with_headphones: {
    label: 'Audio',
    // The condition is in the sentence because it is the whole of the risk:
    // a click through a speaker lands in the take as notes nobody played.
    detail: 'A click in headphones, so it can’t reach the mic.',
  },
};

/** The order the picker offers them in. */
export const METRONOME_ORDER: MetronomeMode[] = [
  'off',
  'visual',
  'haptic',
  'audio_with_headphones',
];

/** Every choice, ready to render. */
export function metronomeChoices(): MetronomeChoice[] {
  return METRONOME_ORDER.map((mode) => ({ mode, ...CHOICES[mode] }));
}

/**
 * What the closed row shows on the right.
 *
 * The label alone: the row already says "Metronome" on its left, so repeating
 * the word there would read as a sentence fragment rather than a value.
 */
export function metronomeValueLabel(mode: MetronomeMode): string {
  return CHOICES[mode].label;
}
