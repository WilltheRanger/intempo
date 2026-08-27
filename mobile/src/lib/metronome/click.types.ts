/**
 * The audible metronome, shared by the native and web implementations.
 *
 * A separate seam from the beat clock on purpose. Anything the screen draws or
 * the phone vibrates can hang off a JS timer and be a millisecond late without
 * a person noticing. A click can't: the ear resolves timing an order of
 * magnitude finer than the eye, and a click that wobbles is worse than none —
 * a musician would play the wobble.
 *
 * So the platforms are allowed to solve this differently. On web the clicks
 * are scheduled against the audio clock, which is sample-accurate and
 * independent of the JS thread. See each file for what it actually does.
 */

export interface ClickTrackOptions {
  bpm: number;
  /** From `beatsPerBar`. Null means every beat is struck the same. */
  perBar: number | null;
}

export interface ClickTrack {
  /** Idempotent. Releases whatever audio resources were held. */
  stop: () => void;
  /**
   * How long after starting the **first click** is due.
   *
   * **Because the eye and the ear were being told different things.** The web
   * implementation books its first click at `currentTime + 0.1` — slack, so
   * the booking is not already in the past — while `startBeatClock`, which
   * drives the on-screen pulse, fires beat zero immediately. That is a fixed
   * **100 ms** gap between seeing the beat and hearing it, on every beat of
   * every take. At 120bpm it is a fifth of a beat: a musician following the
   * screen plays ahead of the click they can hear, and the two cues the
   * metronome exists to give disagree.
   *
   * Reported rather than shared as a constant because it is genuinely per
   * platform — native strikes a player from the same timer the pulse uses and
   * needs no slack at all, so it reports 0 and nothing is delayed.
   */
  leadInS: number;
}
