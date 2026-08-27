import type { ScoreJson, ScoreMeasure } from '../../data/types';

/**
 * Shortening a long stretch of rest, for practising the notes around it.
 *
 * **The analysis has to agree.** A musician who skips a twenty-bar rest plays
 * the bar after it twenty bars early, and the backend's timeline still expects
 * the silence — measured on an otherwise perfect take, quality falls from
 * **1.000 to 0.000** and the verdict becomes "check you're on the right
 * piece". That holds for a two-bar rest as much as a twenty-bar one, because
 * the fit is against a steady grid and the shape is unexplainable either way.
 *
 * So this is not a playback convenience. It is the same transformation the
 * backend applies before building the timeline, and the numbers live in
 * `fixtures/practice/long_rests.json` so the two cannot drift — the same
 * arrangement as `fixtures/timeline`, and for the same reason: two walks over
 * a score in two languages with no way to share code.
 */

/**
 * How long a run has to be before it is worth skipping, and how much survives.
 *
 * Mirrored from the contract, and `longRests.parity.test.ts` fails if they
 * stop matching. Four bars at 60 BPM is sixteen seconds of waiting; below that
 * a rest is part of the phrasing rather than something to sit through.
 */
export const MIN_BARS_TO_SKIP = 4;
export const KEPT_BARS = 1;

/**
 * Holds notes, and every one of them is a rest.
 *
 * A bar with **no notes at all** is not a bar of rest — it is a bar nothing was
 * read from, which the server already reports as `empty`. Folding it into a run
 * of silence would let a hole in the reading shorten the piece.
 */
function isSilent(measure: ScoreMeasure): boolean {
  return measure.notes.length > 0 && measure.notes.every((note) => note.pitch === 'rest');
}

export interface Shortened {
  score: ScoreJson;
  /** How many bars of rest were taken out, for saying so to the musician. */
  skippedBars: number;
}

/**
 * Replace each long run of silent bars with the first few of them.
 *
 * The **first** few, so the bar that survives keeps its number and any metre
 * change printed on it — and a bar rather than nothing, so there is a downbeat
 * to come in on and the metronome has something to count.
 *
 * Measure numbers after a shortened run are left exactly as they were. They are
 * labels off the page, the bars they name were skipped on purpose, and the gap
 * is the truth about what was played.
 */
export function shortenLongRests(score: ScoreJson): Shortened {
  const measures = score.measures ?? [];
  const kept: ScoreMeasure[] = [];
  let skippedBars = 0;

  let index = 0;
  while (index < measures.length) {
    if (!isSilent(measures[index])) {
      kept.push(measures[index]);
      index += 1;
      continue;
    }

    let end = index;
    while (end < measures.length && isSilent(measures[end])) {
      end += 1;
    }
    const run = end - index;
    if (run >= MIN_BARS_TO_SKIP) {
      kept.push(...measures.slice(index, index + KEPT_BARS));
      skippedBars += run - KEPT_BARS;
    } else {
      kept.push(...measures.slice(index, end));
    }
    index = end;
  }

  if (skippedBars === 0) {
    // The same object, not a copy of it. A score with nothing to skip is the
    // common case and rebuilding it would put this in that path for no gain.
    return { score, skippedBars: 0 };
  }
  return { score: { ...score, measures: kept }, skippedBars };
}

/** How many bars a skip would save, without doing it. For offering the option. */
export function skippableBars(score: ScoreJson | null | undefined): number {
  return score ? shortenLongRests(score).skippedBars : 0;
}
