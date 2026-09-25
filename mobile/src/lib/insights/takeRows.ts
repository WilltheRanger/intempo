import type { TakeResult } from '../../data/types';
import { failureTitle, intakeRefusal, nothingUsableTitle } from '../verdict/failureTitle';

/**
 * "Your takes" on a piece as rows — the owner's choice of 2026-09-25, over a
 * card with a chart in it that competed with the score for the top of the
 * page. Each row is when, and what that take's verdict said.
 */

/** How many rows show before "See all". */
export const TAKES_SHOWN = 3;

/**
 * What a take's verdict said, in a row's width: the sentence under its title
 * ("Bars 13–25 went at 81"), or the heading of a take that gave none ("We
 * didn't hear you play"). No full stop: a row is a label, not a sentence.
 */
export function takeRowWords(take: TakeResult): string {
  if (take.failure !== null) {
    return intakeRefusal(take.failure.reason)?.title ?? failureTitle(take.failure);
  }
  if (take.status !== 'ok') {
    return nothingUsableTitle(take.status);
  }
  return take.headline.trim().replace(/\.$/, '') || 'Take';
}

/**
 * Whether a take's row carries a verdict, or says there was none to give — a
 * take the analysis refused or could not time. **The owner, 2026-09-25**: the
 * loudest words under the score were three refusals in full ink. A refusal
 * recedes; a reading leads.
 */
export function takeRowIsVerdict(take: TakeResult): boolean {
  return take.failure === null && take.status === 'ok';
}

/**
 * Each row's date, or null where the row above already said it: three takes
 * today read "Today" once, not three times down the left edge.
 */
export function rowDates(labels: readonly (string | null)[]): (string | null)[] {
  return labels.map((label, index) =>
    index > 0 && label !== null && label === labels[index - 1] ? null : label,
  );
}

/**
 * The link under the rows: "See all 11" when every take is loaded, "See the
 * last 12" when the piece has more than were fetched — a link that says "all"
 * and lists twelve of forty is a wrong fact. Null when there is nothing more
 * to show.
 */
export function moreTakesLabel(total: number, loaded: number): string | null {
  if (loaded <= TAKES_SHOWN) {
    return null;
  }
  return loaded >= total ? `See all ${total}` : `See the last ${loaded}`;
}
