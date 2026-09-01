import type { MetronomeMode } from '../../data/types';

/**
 * What the metronome actually produces, in the count-in and in the take.
 *
 * They are **not the same**, and the difference is not a preference — it is
 * what the microphone can hear.
 *
 * A count-in is how every rehearsal on earth starts: a conductor gives you the
 * beat out loud and you come in on it. So the count-in clicks and buzzes
 * whatever the take's metronome is set to, including "off" — you cannot start
 * together with something that has not counted you in.
 *
 * The take cannot. `alignment.py` measures every onset from the first one it
 * detects, so a click over the phone's speaker while the microphone is open
 * becomes the note the whole take is judged against — which is why the audible
 * mode is called `audio_with_headphones` and why it is the musician's
 * assertion, not ours.
 *
 * The count-in gets away with it because `Recorder.discardCapturedSoFar()`
 * drops the pre-roll on the downbeat: those clicks are recorded and then
 * thrown away, and the file starts where the music does.
 *
 * Here rather than in `RecordScreen.tsx` because there is no React Native
 * testing library in this project (`DECISIONS.md`, 2026-08-24) — a rule inside
 * a component is a rule nothing checks, and this one is four booleans that all
 * look plausible whichever way round they are.
 */
export interface MetronomeOutputs {
  /** An audible tick. */
  click: boolean;
  /** A tap you feel. */
  haptic: boolean;
}

/**
 * The conductor's count. Audible and felt, whatever the take is set to.
 *
 * `haptics` is the profile switch. A musician who turned taps off across the
 * whole app meant it here too — the count is still audible and still on the
 * screen, so nothing is lost that they did not choose to lose.
 */
export function countInOutputs(haptics: boolean): MetronomeOutputs {
  return { click: true, haptic: haptics };
}

/** What the metronome may do once the microphone's output is the take. */
export function takeOutputs(mode: MetronomeMode, haptics: boolean): MetronomeOutputs {
  return {
    click: mode === 'audio_with_headphones',
    haptic: mode === 'haptic' && haptics,
  };
}

/**
 * Whether the metronome has to run at all.
 *
 * True through any count-in, because the count-in is not the metronome
 * feature — it is how a take starts. A musician with the metronome off still
 * gets counted in; they simply do not get clicked at afterwards.
 */
export function metronomeRuns(
  mode: MetronomeMode,
  { countingIn, capturing }: { countingIn: boolean; capturing: boolean },
): boolean {
  if (!capturing) {
    return false;
  }
  return countingIn || mode !== 'off';
}
