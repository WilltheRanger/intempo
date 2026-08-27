import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { monotonicNow, startBeatClock } from './clock';
import type { Beat } from './beats';

/**
 * The beat clock, which had no test.
 *
 * Its own docstring is a promise: *"a metronome that loses a millisecond a
 * beat is a quarter of a second out by the end of a two-minute take. It would
 * be measuring its own error and blaming the musician."* Nothing checked that
 * the promise was kept, and it was being kept against `Date.now()` — the wall
 * clock, which steps when a phone re-syncs time.
 *
 * Driven by an injected clock rather than by real timers, so the assertions
 * are about arithmetic and not about how fast this machine happens to be.
 */

let clockMs = 0;
let beats: Beat[];

/** The time source under the metronome's feet. */
const now = () => clockMs;

/**
 * Move time and the timers together, in small steps.
 *
 * Bumping `clockMs` by the whole span before letting the interval run makes
 * every beat inside it *appear* to fire at the end of the span — which reads
 * as half a second of lateness that the clock never had. The step has to be at
 * most the poll interval for the observed times to mean anything.
 */
const STEP_MS = 10;

function advance(ms: number) {
  for (let done = 0; done < ms; done += STEP_MS) {
    clockMs += STEP_MS;
    vi.advanceTimersByTime(STEP_MS);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  clockMs = 1_000_000;
  beats = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a beat clock', () => {
  it('sounds beat zero immediately, not one period later', () => {
    // "A metronome that starts with a silent beat is a metronome you have to
    // guess the tempo of."
    startBeatClock({ bpm: 60, perBar: 4, onBeat: (b) => beats.push(b), now });

    expect(beats.map((b) => b.index)).toEqual([0]);
    expect(beats[0].downbeat).toBe(true);
  });

  it('does not drift over a two-minute take', () => {
    // The failure the docstring names: *"a metronome that loses a millisecond
    // a beat is a quarter of a second out by the end of a two-minute take."*
    //
    // Counting the beats is not enough to show it — a clock that accumulates
    // its period emits the same number of them, just later and later. So each
    // beat's time is recorded and checked against `index x period`, which is
    // the arithmetic the fix is.
    const at: number[] = [];
    const clock = startBeatClock({
      bpm: 120,
      perBar: 4,
      onBeat: (b) => {
        beats.push(b);
        at.push(clockMs);
      },
      now,
    });
    const startedAt = clockMs;

    for (let second = 0; second < 120; second += 1) advance(1000);
    clock.stop();

    expect(beats).toHaveLength(241); // beat 0 plus 240 half-seconds
    expect(beats[240].index).toBe(240);
    // Poll interval is a fifth of a beat capped at 20ms, so a beat can be
    // noticed at most that late and never early.
    at.forEach((fired, index) => {
      const due = startedAt + index * 500;
      expect(fired).toBeGreaterThanOrEqual(due);
      expect(fired - due).toBeLessThanOrEqual(20);
    });
  });

  it('accents the one, and only the one', () => {
    startBeatClock({ bpm: 60, perBar: 3, onBeat: (b) => beats.push(b), now });

    advance(6000);

    expect(beats.filter((b) => b.downbeat).map((b) => b.index)).toEqual([0, 3, 6]);
  });

  it('stays honest about beats a stalled thread swallowed', () => {
    // A backgrounded tab or a long frame: real time moves on while the timer
    // does not run at all. `fireDue` then has to emit **every** beat that fell
    // in the gap — a single catch-up would leave the count permanently short,
    // and the count is what the accent is derived from, so from then on the
    // "one" lands on the wrong beat of every bar.
    //
    // The clock is moved without letting the interval tick, which is what a
    // stall is. Advancing both together hides this: the timer fires often
    // enough that one beat is ever due at a time, and a single catch-up passes.
    startBeatClock({ bpm: 60, perBar: 4, onBeat: (b) => beats.push(b), now });
    expect(beats.map((b) => b.index)).toEqual([0]);

    clockMs += 5000;
    vi.advanceTimersByTime(20); // one poll, five beats owed

    expect(beats.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(beats[3].downbeat).toBe(false);
    expect(beats[4].downbeat).toBe(true);
  });

  it('does not read the wall clock', () => {
    // **The bug, asserted as the absence it is.** This read `Date.now()`,
    // which steps when a phone re-syncs time. Backwards is the bad direction:
    // `elapsed` goes down, the loop's condition stops holding, and the
    // metronome **silently stops** — mid-take, on the tool that judges the
    // take.
    //
    // The fix is not to tolerate a clock that jumps, it is not to use one. So
    // what is checked is that the wall clock is never consulted at all: a
    // revert to `Date.now()` fails here, and no arrangement of fake times can
    // reproduce a jump that the source no longer has.
    const wall = vi.spyOn(Date, 'now');
    const mono = vi.spyOn(performance, 'now');

    const clock = startBeatClock({ bpm: 60, perBar: 4, onBeat: (b) => beats.push(b) });
    vi.advanceTimersByTime(3000);
    clock.stop();

    expect(mono).toHaveBeenCalled();
    expect(wall).not.toHaveBeenCalled();

    wall.mockRestore();
    mono.mockRestore();
  });

  it('falls back to the wall clock only where there is nothing better', () => {
    // Guarded rather than assumed: `performance.now` is present in Hermes and
    // in every browser, and the fallback is what today already does, so a
    // runtime without it is no worse off than before.
    const original = globalThis.performance;
    try {
      delete (globalThis as { performance?: unknown }).performance;
      expect(monotonicNow()).toBeTypeOf('number');
    } finally {
      Object.defineProperty(globalThis, 'performance', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it('stops, and stopping twice is not an error', () => {
    const clock = startBeatClock({ bpm: 60, perBar: 4, onBeat: (b) => beats.push(b), now });

    advance(1000);
    clock.stop();
    clock.stop();
    const after = beats.length;
    advance(5000);

    expect(beats).toHaveLength(after);
  });

  it('polls fast enough to notice a beat on time', () => {
    // The poll interval is not the beat resolution — beats fire on their
    // computed times — but it does set how late one can be noticed. A fifth of
    // a beat, capped, keeps that under a few milliseconds at any playable
    // tempo. At 40bpm a beat is 1500ms, so a fifth is 300ms, and the cap is
    // what keeps the lateness small.
    startBeatClock({ bpm: 40, perBar: 4, onBeat: (b) => beats.push(b), now });

    advance(1500 + 20);

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
  });

  it('waits out a lead-in before beat zero, then counts from there', () => {
    // **So the eye and the ear count from the same instant.** The web click
    // track books its first click a tenth of a second out — a booking at
    // exactly `currentTime` is already in the past — and this clock fired beat
    // zero immediately, so the screen pulsed 100ms ahead of every click for
    // the whole take. At 120bpm that is a fifth of a beat.
    const at: number[] = [];
    startBeatClock({
      bpm: 60,
      perBar: 4,
      leadInS: 0.1,
      onBeat: (b) => {
        beats.push(b);
        at.push(clockMs);
      },
      now,
    });
    const startedAt = clockMs;

    expect(beats, 'beat zero is not due yet').toEqual([]);

    advance(2000);

    expect(beats.map((b) => b.index)).toEqual([0, 1]);
    at.forEach((fired, index) => {
      expect(fired - startedAt).toBeGreaterThanOrEqual(100 + index * 1000);
    });
  });

  it('treats a negative lead-in as none rather than as time already served', () => {
    startBeatClock({ bpm: 60, perBar: 4, leadInS: -5, onBeat: (b) => beats.push(b), now });

    expect(beats.map((b) => b.index)).toEqual([0]);
  });
});
