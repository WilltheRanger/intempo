/**
 * Where the bar lines fall.
 *
 * The only thing a metronome needs from a score beyond the tempo: which beats
 * are downbeats, so the accent lands where the musician is counting "one".
 *
 * Pure, and separate from anything that ticks, because getting this wrong is
 * silent — an accent on the wrong beat still sounds like a metronome, just one
 * that quietly fights the player.
 */

/**
 * A beat is a quarter note, everywhere in this app.
 *
 * `scheduleScore` scales its beat counts by 60/bpm with `quarter: 1`, so a
 * tempo of 80 means eighty quarter notes a minute. The metronome has to count
 * in the same unit or the clicks and the reference playback would disagree
 * about what the number on screen means.
 */
const QUARTERS_PER_WHOLE = 4;

const TIME_SIGNATURE = /^(\d{1,2})\s*\/\s*(\d{1,2})$/;

/**
 * Quarter-note beats in one bar, or null when there's no sensible accent.
 *
 * Null is a real answer, not a failure: OCR is allowed to return the literal
 * string `"unknown"` for an illegible header, and 9/8 comes to four and a half
 * quarters, which would put "one" halfway through a click. In both cases every
 * beat is struck the same, which is a metronome that is merely plain rather
 * than one that is wrong.
 */
export function beatsPerBar(timeSignature: string | null | undefined): number | null {
  if (!timeSignature) {
    return null;
  }
  const match = TIME_SIGNATURE.exec(timeSignature.trim());
  if (!match) {
    return null;
  }
  const [, top, bottom] = match;
  const numerator = Number(top);
  const denominator = Number(bottom);
  if (numerator <= 0 || denominator <= 0) {
    return null;
  }

  const quarters = (numerator * QUARTERS_PER_WHOLE) / denominator;
  // A bar that isn't a whole number of quarter notes has no beat to accent.
  return Number.isInteger(quarters) && quarters > 0 ? quarters : null;
}

/**
 * Seconds between beats. Guarded so a nonsense tempo cannot break the clock.
 *
 * `Math.max(1, bpm)` covers zero and negatives and **not `NaN`**, because
 * `Math.max` propagates it. That is the whole failure: `periodMs` becomes NaN,
 * `next * periodMs <= elapsed` is false forever so **no beat ever fires**, and
 * the poll interval is NaN too, which `setInterval` reads as zero — a dead
 * metronome spinning a timer as fast as the thread allows.
 *
 * Not reachable from the app today: `practiceTempo.clampBpm` refuses `NaN` and
 * hydration checks `Number.isFinite`, so every bpm that gets here is already
 * clean. This is the guard matching what its own comment claimed rather than a
 * live bug being fixed — and the reason to complete it is that the next caller
 * of `startBeatClock` inherits the boundary check only by accident.
 */
export function secondsPerBeat(bpm: number): number {
  return 60 / (Number.isFinite(bpm) && bpm > 1 ? bpm : 1);
}

export interface Beat {
  /** 0-based, counted from the first beat of the take. */
  index: number;
  /** 0-based position in the bar, or null when there is no bar to place it in. */
  beatInBar: number | null;
  /** The "one". False for every beat when the time signature is unusable. */
  downbeat: boolean;
}

/** Which beat of which bar an index falls on. */
export function beatAt(index: number, perBar: number | null): Beat {
  if (perBar === null) {
    return { index, beatInBar: null, downbeat: false };
  }
  const beatInBar = index % perBar;
  return { index, beatInBar, downbeat: beatInBar === 0 };
}
