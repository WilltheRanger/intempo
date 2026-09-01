import type { ColorToken } from '../../design';
import type { MeasureVerdict } from '../../data/types';
import { formatVerdict, verdictColorFor } from '../tempo';

/**
 * How one measure of a take reads on the verdict screen.
 *
 * **The case this exists for: a written `rit.`** The pipeline forces
 * `band` to `on` for every note under a written tempo change — the page has
 * said the beat will not be steady there, so the tolerance bands measure
 * nothing — but it still reports the **real** `avg_delta_pct`. The app carried
 * neither fact through and rendered both anyway, so a bar where a musician
 * slowed exactly as marked came out as a deviation bar pushed hard to one
 * side, coloured as though it were fine, with the words "On the beat" beside
 * it and `-30%` behind them on a tap.
 *
 * Three statements about one bar, two of which contradict the third. Worse
 * than any of them alone: the app took credit on the musician's behalf for a
 * bar nobody judged, and drew a large error next to the word for no error.
 *
 * A module rather than a branch in `MeasureRow.tsx`, for the usual reason —
 * there is no React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
export interface MeasureReading {
  /** The word in the right-hand column. */
  label: string;
  tone: ColorToken;
  /**
   * Whether the deviation bar means anything.
   *
   * False under a written change: the bar's whole scale is distance from a
   * steady beat, and the page has said there is no steady beat to be distant
   * from. Drawing it to scale would be drawing a measurement that was refused.
   */
  showsDeviation: boolean;
  /**
   * Whether tapping reveals a figure.
   *
   * The figure is real — the musician did slow by that much — but on this row
   * it is not an *error*, and a percentage in the column where every other row
   * shows how far off the beat it was reads as one.
   */
  revealsFigure: boolean;
  /** Read out instead of the verdict, so the row is not silent about why. */
  accessibilityLabel: string;
}

export function readMeasure(measure: MeasureVerdict): MeasureReading {
  if (measure.underTempoChange) {
    // **"Uneven" is the one thing worth saying about a bar like this**, and
    // the pipeline already works it out: `uneven_measures` measures how much
    // each interval grew against what the take usually does, so an even
    // slowing reads 9 ms where a lurch reads 44. It was computed and thrown
    // away at the client boundary.
    const uneven = measure.uneven === true;
    return {
      // **"Not timed", because that is what this column asks.** Every other
      // entry in it answers "how did I play this bar?" — "On tempo", "Slight
      // rush", "Rushing". "Tempo change" answers a different question, about
      // what is printed on the page, and at 13pt it also wrapped to two lines
      // and broke the rhythm of the list. The full sentence is in the
      // accessibility label, where there is room for it.
      label: uneven ? 'Uneven' : 'Not timed',
      // Ochre, not the verdict greens and reds: this is not a judgement about
      // playing, and the accent is what this app uses for "look here".
      tone: uneven ? 'verdictMid' : 'textTertiary',
      showsDeviation: false,
      revealsFigure: false,
      accessibilityLabel: uneven
        ? `Measure ${measure.measure}: the written tempo change was uneven here`
        : `Measure ${measure.measure}: under a written tempo change, not timed`,
    };
  }

  const label = formatVerdict(measure.verdict);
  return {
    label,
    tone: verdictColorFor(measure.band),
    showsDeviation: true,
    revealsFigure: true,
    accessibilityLabel: `Measure ${measure.measure}: ${label}`,
  };
}

/**
 * Whether a measure was actually measured.
 *
 * Used to keep unjudged bars out of an average. A take with a four-bar `rit.`
 * would otherwise have those bars' real deviations pulled into the mean that
 * describes how steadily it was played.
 */
export function wasTimed(measure: { underTempoChange?: boolean }): boolean {
  return measure.underTempoChange !== true;
}
