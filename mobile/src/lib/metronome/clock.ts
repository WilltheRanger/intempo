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

export interface BeatClockOptions {
  bpm: number;
  /** From `beatsPerBar`. Null means no accent — every beat is the same. */
  perBar: number | null;
  onBeat: (beat: Beat) => void;
}

export interface BeatClock {
  /** Idempotent. */
  stop: () => void;
}

export function startBeatClock({ bpm, perBar, onBeat }: BeatClockOptions): BeatClock {
  const periodMs = secondsPerBeat(bpm) * 1000;
  const startedAt = Date.now();
  let next = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function fireDue() {
    const elapsed = Date.now() - startedAt;
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
