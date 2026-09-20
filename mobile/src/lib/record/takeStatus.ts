/**
 * What the take bar says while the microphone is open.
 *
 * **The sentence this replaces was `Microphone: audio received`.** It is
 * accurate, and it is a developer reading a stream, shown to a musician with
 * an instrument up in the one moment they cannot spare attention. The screen
 * has exactly two things to tell them then — the take is running, and sound is
 * arriving — and both want words a player already uses.
 *
 * A module rather than a branch in `RecordScreen.tsx`, for the reason
 * `CLAUDE.md` §3 gives: there is no React Native testing library here, so a
 * rule inside a `.tsx` is a rule nothing checks. This one is worth checking
 * because of what it must **not** say.
 *
 * **It never comments on how loud the take is, and that is a measured rule
 * rather than a preference.** `onset_strength` differences a dB-scaled mel
 * spectrogram, so scaling a waveform shifts every frame by a constant the
 * differencing removes: all six fixtures read identically from 0 dBFS to
 * -90 dBFS (`TUNING_LOG.md`, 2026-09-02). A quiet take is a perfectly good
 * take, and a screen that frets about level talks a musician out of a verdict
 * they would have got. The only recording with nothing in it is one whose
 * every sample is zero — `lib/audio/level.ts` refuses exactly that — so the
 * silent branch here names *no sound at all*, never *not loud enough*.
 */

export interface TakeStatus {
  /** The line under the timer. Null while nothing is being captured. */
  line: string | null;
  /**
   * Whether the line is a problem the musician should act on.
   *
   * The caller colours from this rather than matching on the sentence, so the
   * two cannot drift apart.
   */
  wrong: boolean;
}

/**
 * @param capturing whether the microphone is open — the count-in counts as
 * open, because the stream is live before the first beat and silence during
 * those bars is expected rather than wrong.
 * @param hasSound whether any non-zero sample has arrived yet.
 */
export function takeStatus(capturing: boolean, hasSound: boolean): TakeStatus {
  if (!capturing) {
    return { line: null, wrong: false };
  }
  if (hasSound) {
    // Present tense and about them, not about the device. "Hearing you" is
    // what a person in the room would say, and it is the shortest true thing.
    return { line: 'Hearing you', wrong: false };
  }
  // **Not "too quiet".** Silence here means no sample has been anything but
  // zero, which is a covered microphone, a revoked permission or an unrouted
  // input — never a soft player. The remedy names the two a musician can
  // actually check from where they are standing.
  return { line: 'No sound yet. Check nothing is covering the microphone', wrong: true };
}
