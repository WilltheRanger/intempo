import type { ScoreJson, ScoreMeasure } from '../data/types';
import { metronomePulse, secondsPerBeat } from './metronome/beats';
import { measuresInPlayOrder } from './score/playOrder';
import { BEATS } from './score/schedule';
import { timeSignaturesByMeasure } from './notation/meter';

/**
 * One fully silent bar is long enough to need a re-entry cue.
 *
 * The separate skip-rest option starts at four bars because it changes what is
 * played and analysed. A cue changes nothing, so it can help sooner — and this
 * was two bars until 2026-09-13, which left the single most disorientating
 * case uncovered: one bar of silence is long enough to lose the count and
 * short enough that nothing on screen acknowledged it.
 *
 * **Whole bars only, deliberately.** A rest inside a bar that also has notes
 * is part of a phrase, not a gap to be counted through — the musician is
 * mid-line and reading. Cueing those would need a beat-level model and would
 * put a card on screen during ordinary playing.
 */
export const MIN_BARS_TO_CUE = 1;

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
  /**
   * Which felt pulse of the rest this is, counted from its first — 0, 1, 2 …
   *
   * **The beat, as a value that changes exactly once per pulse.** The screen
   * flashes and the device taps on a change of this number rather than on a
   * timer of their own, so the pulse a musician sees and feels is the one the
   * metronome is counting and not a second clock drifting beside it.
   *
   * Counted across bars rather than within one, because a meter change inside
   * a rest would otherwise reset it and produce two pulses in a row that look
   * identical.
   */
  pulse: number;
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

  // Pulses completed before this bar, then within it. Summed rather than
  // divided, because `barQuarterBeatsPerPulse` can differ per bar.
  let pulse = 0;
  for (let i = 0; i < barIndex; i += 1) {
    const start = i === 0 ? cue.startBeat : cue.barEndBeats[i - 1];
    const size = cue.barQuarterBeatsPerPulse[i];
    const felt = Number.isFinite(size) && size > 0 ? size : 1;
    pulse += Math.round((cue.barEndBeats[i] - start) / felt);
  }
  const barStart = barIndex === 0 ? cue.startBeat : cue.barEndBeats[barIndex - 1];
  pulse += Math.floor((elapsedBeats - barStart) / pulseSize + 1e-9);

  return {
    cue,
    barsRemaining: cue.barEndBeats.length - barIndex,
    beatsRemainingInBar,
    pulse,
  };
}

/**
 * The pulse row for the bar being counted: which beat, of how many.
 *
 * **A rule, not a line in the component.** There is no React Native testing
 * library here (`DECISIONS.md`, 2026-08-24), and every way of getting this
 * subtly wrong is silent — an off-by-one puts the filled dot a beat ahead of
 * the tap a musician feels, which is worse than no dots at all.
 *
 * `beatsRemainingInBar` counts the pulse currently sounding as remaining, so
 * the beat in progress is `total - remaining`. A bar whose meter could not be
 * read falls back to one pulse, the same fallback `restCueAt` uses.
 */
export function restPulseDots(state: RestCueState): {
  dots: boolean[];
  current: number;
  total: number;
} {
  // `barsRemaining` counts the bar in progress, so the bar being played is
  // that many from the end.
  const barIndex = state.cue.barEndBeats.length - state.barsRemaining;
  const safeIndex = Math.min(
    Math.max(0, barIndex),
    state.cue.barEndBeats.length - 1,
  );
  const start =
    safeIndex === 0 ? state.cue.startBeat : state.cue.barEndBeats[safeIndex - 1];
  const size = state.cue.barQuarterBeatsPerPulse[safeIndex];
  const felt = Number.isFinite(size) && size > 0 ? size : 1;
  const total = Math.max(1, Math.round((state.cue.barEndBeats[safeIndex] - start) / felt));
  const current = Math.min(
    total - 1,
    Math.max(0, total - state.beatsRemainingInBar),
  );
  return {
    dots: Array.from({ length: total }, (_, i) => i <= current),
    current,
    total,
  };
}
