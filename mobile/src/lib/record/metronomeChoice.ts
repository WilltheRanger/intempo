import type { MetronomeMode } from '../../data/types';

/**
 * The four ways to mark the beat.
 *
 * **Why this exists: on the record screen the mode could not be chosen at
 * all.** The control there was a two-state toggle between `off` and whichever
 * mode was last on, so a musician who wanted a click for the first time had to
 * leave a screen with an instrument up, find the setting in Profile, choose,
 * and come back. Three of the four modes were unreachable from the one place
 * anybody wants them.
 *
 * A module rather than a list inside the screen, for the reason `CLAUDE.md`
 * §3 gives.
 *
 * **Labels only, no line under each** — the owner, 2026-09-30: "remove this
 * writing as well. Its everywhere, and its over explaining". Each line said
 * what the label already does ("Visual / A silent pulse on screen"), and the
 * two that carried a condition are said where the condition actually applies:
 *
 * - **Audio can ruin a take.** A click through the speaker reaches the
 *   microphone as onsets nobody played. `HEADPHONES_WARNING` stands under the
 *   metronome setting while Audio is chosen, on the record screen and in
 *   Profile. The pre-flight check (`preflight.speakerBleed`) is not enough on
 *   its own: it opens by itself only before a musician's first take, and after
 *   that sits behind "Before you record".
 * - **Haptic needs haptics on in Profile.** The record screen says "Haptics
 *   are off in Profile, so nothing marks the beat" exactly when they are.
 *
 * A warning shown when it applies is read; the same warning printed under an
 * option every time it is offered is the grey type §3 law 10 says a musician
 * learns to skip.
 */

export interface MetronomeChoice {
  mode: MetronomeMode;
  /** The row's own label, in the picker and on the closed row. */
  label: string;
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
  off: { label: 'Off' },
  visual: { label: 'Visual' },
  haptic: { label: 'Haptic' },
  audio_with_headphones: { label: 'Audio' },
};

/**
 * Said under the metronome setting while Audio is chosen, wherever the setting
 * is — one sentence for the record screen and Profile, so they cannot come to
 * say different things about the one risk in this list.
 */
export const HEADPHONES_WARNING = 'Use headphones, or the click ends up in the recording.';

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
