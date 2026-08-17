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
}
