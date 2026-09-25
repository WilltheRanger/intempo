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

/**
 * The count beside "Your takes": "14 since Sep 13", or "14" when the start is
 * not known to be the real one.
 *
 * `PieceHistory.since` is already null when the count hit the page ceiling —
 * see `getPieceHistory` — and an unparseable date is refused for the same
 * reason: "since Invalid Date" is worse than the count alone. The heading
 * already says they are takes.
 */
export function historyCount(history: PieceHistory): string | null {
  if (history.takes === 0) {
    return null;
  }
  const date = history.since ? new Date(history.since) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return String(history.takes);
  }
  const short = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${history.takes} since ${short}`;
}
