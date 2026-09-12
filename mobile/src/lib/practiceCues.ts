import type { ScoreJson, ScoreMeasure } from '../data/types';
import { metronomePulse, secondsPerBeat } from './metronome/beats';
import { measuresInPlayOrder } from './score/playOrder';
import { BEATS } from './score/schedule';
import { timeSignaturesByMeasure } from './notation/meter';

/**
 * Two fully silent bars is long enough to need a re-entry cue.
 *
 * The separate skip-rest option starts at four bars because it changes what is
 * played and analysed. A cue changes nothing, so it can help sooner.
 */
export const MIN_BARS_TO_CUE = 2;

const UNKNOWN_DURATION_BEATS = 1;

function isSilentMeasure(measure: ScoreMeasure): boolean {
  return (
    measure.notes.length > 0 &&
    measure.notes.every((note) => note.pitch === 'rest')
  );
}

/**
 * The same clock used by score playback and backend alignment.
 *
 * Do not replace this with the time signature. A pickup bar, an OCR concern, or
 * a written partial bar may not fill its meter, while the analyser still walks
 * the note durations it received. A cue that follows the printed meter while
 * the take follows the timeline would bring the musician in at the wrong time.
 */
function measureBeats(measure: ScoreMeasure): number {
  return measure.notes.reduce(
    (total, note) => total + (BEATS[note.duration] ?? UNKNOWN_DURATION_BEATS),
    0,
  );
}

export interface LongRestCue {
  /** Quarter-note beats from the first written note/rest. */
  startBeat: number;
  endBeat: number;
  /** End of each silent measure, on the same clock. */
  barEndBeats: number[];
  /**
   * Felt pulse size for each silent bar, in quarter-note beats.
   *
   * Kept beside the bar boundary because a meter can change inside the rest.
   * The final countdown must use the meter printed for the bar it is in, not
   * the signature the piece opened with.
   */
  barQuarterBeatsPerPulse: number[];
  bars: number;
  /** The measure where playing resumes. */
  resumeMeasure: number;
}

export interface RestCueState {
  cue: LongRestCue;
  /** Includes the silent bar currently being counted. */
  barsRemaining: number;
  /** Felt pulses left in the current silent bar. */
  beatsRemainingInBar: number;
}

/**
 * Find full-measure rest runs that lead back into music.
 *
 * Empty measures are not rests: they mean the page reader found no writable
 * notes. Trailing silence has no re-entry and therefore needs no countdown.
 */
export function longRestCues(
  score: ScoreJson | null | undefined,
  minimumBars = MIN_BARS_TO_CUE,
): LongRestCue[] {
  if (!score) {
    return [];
  }

  const measures = measuresInPlayOrder(score);
  // Written order, deliberately. A repeat jumps back to the meter that was in
  // force at the printed bar, even if a later bar changed it before the jump.
  const meters = timeSignaturesByMeasure(score);
  const cues: LongRestCue[] = [];
  const minimum = Math.max(1, Math.floor(minimumBars));
  let clock = 0;
  let index = 0;

  while (index < measures.length) {
    const measure = measures[index];
    if (!isSilentMeasure(measure)) {
      clock += measureBeats(measure);
      index += 1;
      continue;
    }

    const startBeat = clock;
    const barEndBeats: number[] = [];
    const barQuarterBeatsPerPulse: number[] = [];
    let end = index;
    while (end < measures.length && isSilentMeasure(measures[end])) {
      const silent = measures[end];
      clock += measureBeats(silent);
      barEndBeats.push(clock);
      barQuarterBeatsPerPulse.push(
        metronomePulse(meters.get(silent.measure_number))?.quarterBeats ?? 1,
      );
      end += 1;
    }

    const next = measures[end];
    // An empty OCR bar is neither a rest nor evidence of an entrance.
    // Do not bridge that unknown bar to find a later note.
    if (
      barEndBeats.length >= minimum &&
      next?.notes.some((note) => note.pitch !== 'rest')
    ) {
      cues.push({
        startBeat,
        endBeat: clock,
        barEndBeats,
        barQuarterBeatsPerPulse,
        bars: barEndBeats.length,
        resumeMeasure: next.measure_number,
      });
    }

    index = end;
  }

  return cues;
}

/** The re-entry cue at this instant, if the take is inside a long rest. */
export function restCueAt(
  cues: LongRestCue[],
  elapsedMs: number,
  bpm: number,
): RestCueState | null {
  const elapsedBeats = Math.max(0, elapsedMs) / 1000 / secondsPerBeat(bpm);
  const cue = cues.find(
    (candidate) =>
      elapsedBeats >= candidate.startBeat && elapsedBeats < candidate.endBeat,
  );
  if (!cue) {
    return null;
  }

  const barIndex = cue.barEndBeats.findIndex((end) => end > elapsedBeats);
  if (barIndex < 0) {
    return null;
  }

  // Subtract a hair before ceil so an exact beat boundary reads 3, not 4
  // because of floating-point residue from the timer.
  const candidatePulse = cue.barQuarterBeatsPerPulse[barIndex];
  const pulseSize =
    Number.isFinite(candidatePulse) && candidatePulse > 0
      ? candidatePulse
      : 1;
  const beatsRemainingInBar = Math.max(
    1,
    Math.ceil((cue.barEndBeats[barIndex] - elapsedBeats) / pulseSize - 1e-9),
  );

  return {
    cue,
    barsRemaining: cue.barEndBeats.length - barIndex,
    beatsRemainingInBar,
  };
}
