import type { ScoreJson, ScoreMeasure } from '../data/types';
import { secondsPerBeat } from './metronome/beats';
import { measuresInPlayOrder } from './score/playOrder';
import { BEATS } from './score/schedule';

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
    let end = index;
    while (end < measures.length && isSilentMeasure(measures[end])) {
      clock += measureBeats(measures[end]);
      barEndBeats.push(clock);
      end += 1;
    }

    const next = measures[end];
    if (barEndBeats.length >= minimum && next && !isSilentMeasure(next)) {
      cues.push({
        startBeat,
        endBeat: clock,
        barEndBeats,
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
  quarterBeatsPerPulse = 1,
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
  const pulseSize =
    Number.isFinite(quarterBeatsPerPulse) && quarterBeatsPerPulse > 0
      ? quarterBeatsPerPulse
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
