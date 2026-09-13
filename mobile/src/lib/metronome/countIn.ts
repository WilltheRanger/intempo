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
  /**
   * This pulse should be felt and seen more strongly than an ordinary one.
   *
   * True through a written rest, where there is no sound of your own to count
   * against and the beat is the only thing holding the place.
   */
  emphasis: boolean;
}

/**
 * The conductor's count. Audible and felt, whatever the take is set to.
 *
 * `haptics` is the profile switch. A musician who turned taps off across the
 * whole app meant it here too — the count is still audible and still on the
 * screen, so nothing is lost that they did not choose to lose.
 */
export function countInOutputs(haptics: boolean): MetronomeOutputs {
  return { click: true, haptic: haptics, emphasis: true };
}

/**
 * What the metronome may do once the microphone's output is the take.
 *
 * **A written rest taps even when the mode does not**, added 2026-09-13. A
 * rest is where the count is easiest to lose — there is no sound of your own
 * to hold the place against — and a tap is the one output that costs nothing,
 * because haptics are not recorded. The profile switch still wins: a musician
 * who turned taps off across the app meant it here too.
 *
 * `click` is deliberately **not** widened by a rest, however tempting. The
 * docstring above is the reason and it applies inside a rest as much as
 * outside it: the speaker is open to the microphone, and a click landing in a
 * bar the score says is silent is read as a note played during a rest. That
 * needs `alignment.py` to know the metronome was audible before it can be
 * safe, and it does not yet.
 */
export function takeOutputs(
  mode: MetronomeMode,
  haptics: boolean,
  { resting = false }: { resting?: boolean } = {},
): MetronomeOutputs {
  return {
    click: mode === 'audio_with_headphones',
    haptic: haptics && (mode === 'haptic' || resting),
    emphasis: resting,
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

/**
 * Whether the count is up and the take has begun.
 *
 * **The trigger for `discardCapturedSoFar()`**, and the one part of the
 * count-in that was still a rule inside `RecordScreen.tsx` — in a module whose
 * own docstring, twenty lines up, says a rule inside a component is a rule
 * nothing checks. It decides where a musician's file starts, and every way of
 * getting it wrong is silent:
 *
 *  - **one beat early** and the last count click is still in the capture. It
 *    is the loudest thing in the file and the first onset in it, so
 *    `alignment.py` anchors the whole take to the metronome instead of to the
 *    music, and every note is reported against a beat that was never played.
 *  - **one beat late** and the first note the musician played is thrown away,
 *    which reads as rushing for the rest of the piece.
 *  - **without the `countingIn` guard** it fires again on every beat of the
 *    take, discarding the music continuously, and the take comes back empty.
 *
 * `>=` rather than `===` on purpose. The beat this reads is a rendered value,
 * and two beats arriving inside one render — a slow frame, a coalesced state
 * update, a fast tempo — would step the index past the downbeat. With `===`
 * the count-in would then never end: the recorder keeps the pre-roll, the
 * screen stays counting, and the musician is playing into a take that has not
 * started. Firing late is recoverable; not firing is not.
 */
export function countInIsOver({
  countingIn,
  beatIndex,
  countInBeats,
}: {
  countingIn: boolean;
  /** The metronome's current beat, or null before the clock has emitted one. */
  beatIndex: number | null;
  /** Pulses before the first played downbeat — `MetronomePlan.countInPulses`. */
  countInBeats: number;
}): boolean {
  if (!countingIn || beatIndex === null) {
    return false;
  }
  return beatIndex >= countInBeats;
}
