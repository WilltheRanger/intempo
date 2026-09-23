import type { PieceHistory } from '../../data/sources/types';

/**
 * What a piece's own practice history says, on the screen for that piece.
 *
 * **The piece screen knew nothing about the piece's past.** Today answers "how
 * did last time go" across the library and Insights answers "what do I tend to
 * do" across thirty days; the screen for one piece — the screen a musician
 * opens *because* they are about to play that piece — answered neither about
 * it. `GET /v1/analyses` has taken a `score_id` all along.
 *
 * Every rule here is about not overclaiming. A count that might be a page
 * boundary does not get a date; a take that failed is not a session; a
 * headline written about a different piece never appears.
 */

/** "12 takes", "1 take". */
export function takeCountLabel(takes: number): string {
  return takes === 1 ? '1 take' : `${takes} takes`;
}

/**
 * "since 3 March", or null when the date is not known to be the real start.
 *
 * `PieceHistory.since` is already null when the count hit the page ceiling —
 * see `getPieceHistory`. This is the formatting half, and it refuses an
 * unparseable date for the same reason: a card reading "since Invalid Date" is
 * worse than one that just says how many.
 */
export function practiceSince(since: string | null): string | null {
  if (!since) {
    return null;
  }
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `since ${date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })}`;
}

/** The line over the history: how many takes, and since when if that is known. */
export function historyLabel(history: PieceHistory): string | null {
  if (history.takes === 0) {
    return null;
  }
  const since = practiceSince(history.since);
  const count = takeCountLabel(history.takes);
  return since ? `${count} ${since}` : count;
}
