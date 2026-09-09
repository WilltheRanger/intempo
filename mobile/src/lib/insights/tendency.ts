import type { Band, Direction, Tolerance, Verdict } from '../../data/types';
import { sessionLabel } from '../format';
import {
  bandFor,
  directionFor,
  spreadIsBeyondTolerance,
  verdictFor,
} from '../tempo';

/**
 * What a window of practice says about a musician, and how it is worded.
 *
 * **Insights had one statistic and it cancels.** `meanDeviationPct` is a
 * signed mean, which answers "which way do you drift" and is silent about "how
 * much do you wander" — and the screen led with the answer to a question it
 * had not asked. Two failures were measured on the real mapping layer before
 * this module existed:
 *
 *  - One take alternating 18% ahead and 18% behind, bar by bar, averaged to
 *    **0**. The deviation bar sat dead centre while the title read *"You tend
 *    to rush"* and the sentence under it read *"you were usually ahead of the
 *    beat"* — a claim the bar directly beneath it contradicted.
 *  - Two takes, one 15% behind and one 15% ahead, averaged to **0** and the
 *    screen said *"You tend to drag"*. Swapping the order the two arrived in
 *    made the same practice read *"You tend to rush"*.
 *
 * Both had one cause: the headline's band and direction were **borrowed from
 * one take** — whichever happened to sit nearest the mean, first-wins on a tie
 * — rather than computed from the practice being summarised. The comment
 * defending that said the thresholds were the server's and would move, which
 * was true and is no longer an obstacle: `result_json.tolerance` carries the
 * six numbers each take was judged by, so `bandFor` applies the server's own
 * cutoffs.
 *
 * Deriving from the aggregate fixes the order-dependence and leaves a second,
 * quieter wrong answer: both those cases now read *"You play steadily"*, which
 * over a musician landing 18% off the beat in both directions is a worse thing
 * to say than the original. So the headline gets a third thing it can be.
 *
 * A module rather than a branch in `InsightsScreen.tsx`, for the usual reason:
 * there is no React Native testing library here (`DECISIONS.md`, 2026-08-24),
 * so a rule written inside a `.tsx` is a rule nothing checks.
 */
const TENDENCY_HEADLINES: Record<Verdict, string> = {
  on_tempo: 'You play steadily',
  slight_rush: 'You drift slightly ahead',
  rushing: 'You tend to rush',
  slight_drag: 'You drift slightly behind',
  dragging: 'You tend to drag',
};

/**
 * The headline for a whole window of practice — Insights, not one take.
 *
 * "You tend to..." is a claim about a habit, and a habit needs more than one
 * recording to observe. A single take gets `formatTakeVerdict` instead.
 *
 * A description of what happened, not encouragement about it — the spec is
 * explicit that words carry the verdict, and a musician can tell the
 * difference between a diagnosis and a compliment.
 */
function formatTendency(verdict: Verdict): string {
  return TENDENCY_HEADLINES[verdict] ?? TENDENCY_HEADLINES.on_tempo;
}

const TENDENCY_DETAIL: Record<Verdict, string> = {
  on_tempo: 'you held the beat',
  slight_rush: 'you sat a little ahead of the beat',
  rushing: 'you were usually ahead of the beat',
  slight_drag: 'you sat a little behind the beat',
  dragging: 'you were usually behind the beat',
};

/**
 * "Across 34 sessions, you were usually ahead of the beat."
 *
 * No timing figure: the spec keeps deviations out of production copy and
 * leaves the magnitude to the bar. Session counts aren't a timing
 * measurement, so they stay.
 */
function formatTendencyDetail(
  verdict: Verdict,
  sessions: number,
): string {
  const count = sessions === 1 ? '1 session' : `${sessions} sessions`;
  const detail = TENDENCY_DETAIL[verdict] ?? TENDENCY_DETAIL.on_tempo;
  return `Across ${count}, ${detail}.`;
}

export interface TendencyReading {
  /** The screen's title. The finding, which is what this screen leads with. */
  title: string;
  /** The sentence under it. */
  detail: string;
  /**
   * Whether the deviation bar should draw the spread on both sides of the
   * centre instead of the signed mean.
   *
   * True exactly when the finding is unevenness. A bar drawn from a mean of
   * zero under the words "Your tempo wanders" is the same contradiction this
   * module exists to remove, one element lower down: the magnitude belongs to
   * the bar (`formatTendencyDetail` says so), and for a two-sided quantity the
   * honest drawing is two-sided.
   */
  showsSpread: boolean;
  /** Read out for the bar, which has no words of its own. */
  spoken: string;
}

export interface WindowSummary {
  sessions: number;
  meanDeviationPct: number;
  spreadPct: number;
  verdict: Verdict;
  tolerance: Tolerance | null;
}

/**
 * Whether the wandering is the finding rather than the direction.
 *
 * **Both thresholds are the server's**, so this invents no number: the bias is
 * inside the band the pipeline calls on-tempo, and the average distance from
 * the beat is not. That is precisely the case a direction cannot describe —
 * the musician is far from the beat and not consistently on either side of it.
 *
 * Framed as two threshold tests rather than a ratio between the two figures on
 * purpose. A ratio ("the spread is more than twice the bias") would be a
 * constant chosen here, and `TUNING_LOG.md` exists because numbers chosen here
 * are the ones that turn out to be wrong.
 */
export function tempoWanders(summary: {
  meanDeviationPct: number;
  spreadPct: number;
  tolerance: Tolerance | null;
}): boolean {
  return (
    bandFor(summary.meanDeviationPct, summary.tolerance) === 'on' &&
    spreadIsBeyondTolerance(summary.spreadPct, summary.tolerance)
  );
}

export function readTendency(summary: WindowSummary): TendencyReading {
  const count = sessionLabel(summary.sessions);

  if (tempoWanders(summary)) {
    // The one figure in this screen's copy, and it is here because the
    // alternative is stating the magnitude nowhere. `formatTendencyDetail`
    // leaves magnitudes to the bar, which works while the quantity has a side;
    // a musician told only that they "landed on both sides" has been told the
    // shape of the problem and not its size.
    const out = `${Math.round(summary.spreadPct)}%`;
    return {
      title: 'Your tempo wanders',
      detail:
        `Across ${count} you landed on both sides of the beat rather than ` +
        `settling on one — ${out} out on average, either way.`,
      showsSpread: true,
      spoken: `Your tempo wanders, about ${out} off the beat on either side, across ${count}`,
    };
  }

  return {
    title: formatTendency(summary.verdict),
    detail: formatTendencyDetail(summary.verdict, summary.sessions),
    showsSpread: false,
    spoken: `${formatTendency(summary.verdict)} across your recent practice`,
  };
}

/**
 * The word for one piece in the list below, which has room for one or two.
 *
 * "Uneven" rather than a sentence, and the same word `measureReading.ts`
 * already uses for a bar whose tempo change lurched — the app has a vocabulary
 * for this idea and a second one would be two names for one thing.
 *
 * Without it a wandering piece reads "On tempo" in its own row, which is the
 * headline's bug one level down and on the row a musician taps to go and
 * practise.
 */
export function readPieceWord(piece: {
  meanDeviationPct: number;
  spreadPct: number;
  tolerance: Tolerance | null;
  verdict: Verdict;
}): string {
  return tempoWanders(piece) ? 'Uneven' : VERDICT_WORDS[piece.verdict];
}

const VERDICT_WORDS: Record<Verdict, string> = {
  on_tempo: 'On tempo',
  slight_rush: 'Slight rush',
  rushing: 'Rushing',
  slight_drag: 'Slight drag',
  dragging: 'Dragging',
};

/**
 * Band, direction and verdict for an aggregate, from the aggregate itself.
 *
 * The replacement for borrowing them off whichever take sat nearest the mean.
 * One function so the window headline and every piece row derive them the same
 * way — they disagreed once already, and `api.test.ts` has a test named for
 * that.
 */
export function judgeAggregate(
  meanDeviationPct: number,
  tolerance: Tolerance | null,
): { band: Band; direction: Direction; verdict: Verdict } {
  const band = bandFor(meanDeviationPct, tolerance);
  const direction = directionFor(meanDeviationPct, band);
  return { band, direction, verdict: verdictFor(band, direction) };
}
