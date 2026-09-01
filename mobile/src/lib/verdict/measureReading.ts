import type { ColorToken } from '../../design';
import type { MeasureVerdict, UntimedReason } from '../../data/types';
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

/**
 * Whether anything in the bar was measured against a time the page states.
 *
 * `null` is an older take, from before the pipeline reported the count: read
 * as "all of them", which is what those rows meant.
 */
function nothingTimed(measure: MeasureVerdict): boolean {
  return measure.timedNoteCount === 0;
}

/**
 * What to call a bar nothing in which could be timed.
 *
 * **"Not timed" was the app's word for all three, and it is the app's word,
 * not the page's.** It reads as a failure to measure — which is exactly right
 * for `ornament`, where the pipeline is admitting it guessed, and wrong for
 * the other two, where the page gave an instruction and the musician followed
 * it. A held final chord is not a bar the app could not judge; it is a bar the
 * composer said not to.
 *
 * The labels sit in the same column as "On tempo", "Slight rush", "Rushing",
 * so they answer the same question — *how did I play this bar?* — in one or
 * two words. The sentence goes in the spoken label, where there is room.
 *
 * `unsaid` covers two cases on purpose: a take analysed before the pipeline
 * reported a reason, and a bar whose untimed notes disagree. Both mean "no
 * single reason", which is one sentence.
 */
const UNTIMED_WORDS: Record<
  UntimedReason | 'unsaid',
  { label: string; spoken: string } | null
> = {
  fermata: {
    label: 'Held',
    spoken: 'held — the page marks a fermata, so its length is yours',
  },
  // Reached only through the branch above in practice, since a bar under a
  // change is caught by `underTempoChange` first. Here so the table is total
  // rather than relying on that ordering staying true.
  tempo_change: {
    label: 'Not timed',
    spoken: 'under a written tempo change, not timed',
  },
  ornament: {
    label: 'Not timed',
    spoken:
      'not timed — an ornament is placed by an estimate rather than by the page',
  },
  unsaid: null,
};

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

  if (nothingTimed(measure)) {
    const named = UNTIMED_WORDS[measure.untimedReason ?? 'unsaid'];
    if (named) {
      return {
        label: named.label,
        tone: 'textTertiary',
        showsDeviation: false,
        revealsFigure: false,
        accessibilityLabel: `Measure ${measure.measure}: ${named.spoken}`,
      };
    }
    // **A `rit.` is not the only way a bar goes unjudged**, and the other two
    // are ordinary notation. A fermata says one length is not written down at
    // all — the mark exists precisely to hand it to the player — so the
    // interval after it cannot be measured against a written value. An ornament
    // and the note it decorates are placed by `ORNAMENT_SHARE`, a number the
    // pipeline invented to split the difference between two readings an
    // engraver may have meant.
    //
    // A bar made *entirely* of those is short and common: a held final
    // chord, a bar that is one ornamented note. It read "On tempo" — the app
    // agreeing that a bar was played in time when nothing in it was timed.
    return {
      label: 'Not timed',
      tone: 'textTertiary',
      showsDeviation: false,
      revealsFigure: false,
      accessibilityLabel: `Measure ${measure.measure}: nothing here could be timed against the page`,
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
export function wasTimed(measure: {
  underTempoChange?: boolean;
  timedNoteCount?: number | null;
}): boolean {
  return measure.underTempoChange !== true && measure.timedNoteCount !== 0;
}
