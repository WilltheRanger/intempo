import { beatAt, secondsPerBeat, type Beat } from './beats';

/**
 * A beat clock that doesn't drift.
 *
 * Every beat's time is computed from the start — `start + index × period` —
 * rather than by adding a period to the last one. The difference matters here
 * more than almost anywhere else in the app: this is a tool for telling people
 * their timing is off, and a metronome that loses a millisecond a beat is a
 * quarter of a second out by the end of a two-minute take. It would be
 * measuring its own error and blaming the musician.
 *
 * The polling interval is deliberately much shorter than a beat. It is not the
 * beat resolution — beats fire on their computed times, not on ticks — it only
 * sets how late a beat can be noticed. A fifth of a beat, capped, keeps that
 * under a few milliseconds at any tempo a person plays at.
 *
 * Timer-driven, so this is right for anything the JS thread renders or
 * vibrates. Audible clicks are a different problem, and `click.web.ts` solves
 * it against the audio clock instead.
 */

/** Never poll slower than this, however slow the tempo. */
const MAX_POLL_MS = 20;

/**
 * A clock that only goes forwards.
 *
 * **This read `Date.now()`, which is the wall clock and can step.** A phone
 * re-syncs time over the network, and after flight mode or a long sleep the
 * step is not always small. Backwards is the bad direction: `elapsed` goes
 * down, the `while` loop's condition stops being true, and **the metronome
 * silently stops clicking** until real time catches up to where it thought it
 * was. Forwards fires a burst of beats at once.
 *
 * Either way this is a tool for telling people their timing is off, and its
 * whole docstring above is a promise not to drift. A clock that can jump is
 * not a smaller version of drift; it is the same failure the comment describes,
 * arriving all at once and blamed on the musician.
 *
 * `performance.now()` is monotonic and is present in every runtime this app
 * has — Hermes on both platforms and every browser — but it is guarded rather
 * than assumed, because the fallback is what today already does.
 */
export function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export interface BeatClockOptions {
  bpm: number;
  /** From `beatsPerBar`. Null means no accent — every beat is the same. */
  perBar: number | null;
  onBeat: (beat: Beat) => void;
  /** The time source, in milliseconds. Injected only so tests can drive it. */
  now?: () => number;
}

export interface BeatClock {
  /** Idempotent. */
  stop: () => void;
}

export function startBeatClock({
  bpm,
  perBar,
  onBeat,
  now = monotonicNow,
}: BeatClockOptions): BeatClock {
  const periodMs = secondsPerBeat(bpm) * 1000;
  const startedAt = now();
  let next = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function fireDue() {
    const elapsed = now() - startedAt;
    // A loop, not an `if`: a backgrounded tab or a long frame can swallow
    // several beats, and the count has to stay honest about how many passed.
    while (next * periodMs <= elapsed) {
      onBeat(beatAt(next, perBar));
      next += 1;
    }
  }

  // Beat zero is now, not one period from now. A metronome that starts with a
  // silent beat is a metronome you have to guess the tempo of.
  fireDue();
  timer = setInterval(fireDue, Math.max(1, Math.min(MAX_POLL_MS, periodMs / 5)));

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
