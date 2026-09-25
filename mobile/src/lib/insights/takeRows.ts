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
