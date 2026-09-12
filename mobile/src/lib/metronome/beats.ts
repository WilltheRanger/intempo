/**
 * The pulse a musician feels in a bar.
 *
 * Score durations and analysis stay on a quarter-note clock. This translates
 * that clock into the note value a metronome should actually click, so 6/8 is
 * two dotted-quarter pulses instead of three quarter-note clicks.
 */

const QUARTERS_PER_WHOLE = 4;
const TIME_SIGNATURE = /^(\d{1,2})\s*\/\s*(\d{1,2})$/;

export interface MetronomePulse {
  /** Duration of one felt pulse on the app's quarter-note score clock. */
  quarterBeats: number;
  /** Felt pulses in one complete bar. */
  pulsesPerBar: number;
  /** Plain-language note value, for future tempo labels. */
  unitLabel: string;
}

function noteName(denominator: number): string {
  const names: Record<number, string> = {
    1: 'whole',
    2: 'half',
    4: 'quarter',
    8: 'eighth',
    16: 'sixteenth',
    32: 'thirty-second',
    64: 'sixty-fourth',
  };
  return names[denominator] ?? `${denominator}th-note`;
}

/**
 * How this meter should be counted, without changing what stored BPM means.
 *
 * Compound meters divide into groups of three: 6/8 is two dotted quarters,
 * 9/8 is three, and 12/8 is four. Simple and irregular meters use the written
 * denominator. For an irregular meter such as 7/8 the source score does not
 * carry beam grouping, so seven eighth-note pulses are honest; inventing 2+2+3
 * would put an accent somewhere the page never specified.
 */
export function metronomePulse(
  timeSignature: string | null | undefined,
): MetronomePulse | null {
  if (!timeSignature) {
    return null;
  }
  const match = TIME_SIGNATURE.exec(timeSignature.trim());
  if (!match) {
    return null;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (numerator <= 0 || denominator <= 0) {
    return null;
  }

  const writtenUnit = QUARTERS_PER_WHOLE / denominator;
  const compound = numerator > 3 && numerator % 3 === 0;
  const quarterBeats = writtenUnit * (compound ? 3 : 1);
  const pulsesPerBar = compound ? numerator / 3 : numerator;
  if (!Number.isFinite(quarterBeats) || quarterBeats <= 0 || pulsesPerBar <= 0) {
    return null;
  }

  return {
    quarterBeats,
    pulsesPerBar,
    unitLabel: compound
      ? `dotted ${noteName(denominator / 2)}`
      : noteName(denominator),
  };
}

/** Felt pulses in one bar, or null when the meter is unusable. */
export function beatsPerBar(timeSignature: string | null | undefined): number | null {
  return metronomePulse(timeSignature)?.pulsesPerBar ?? null;
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
  /** 0-based, counted from the first pulse of the count-in. */
  index: number;
  /** 0-based position in the bar, or null when there is no bar to place it in. */
  beatInBar: number | null;
  /** The "one". False for every beat when the time signature is unusable. */
  downbeat: boolean;
  /**
   * Felt pulses in this beat's bar when a changing-meter plan supplied it.
   * Absent on the legacy fixed clock, whose caller already owns `perBar`.
   */
  pulsesPerBar?: number | null;
}

/** Which beat of which bar an index falls on. */
export function beatAt(index: number, perBar: number | null): Beat {
  if (perBar === null) {
    return { index, beatInBar: null, downbeat: false };
  }
  const beatInBar = index % perBar;
  return { index, beatInBar, downbeat: beatInBar === 0 };
}
