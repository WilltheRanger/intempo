import type { PieceHistory } from '../../data/sources/types';
import { shortDate } from '../calendarDate';
import { takeDateLabel, takeRowTitle } from './takeRows';

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
  return `${history.takes} since ${shortDate(date)}`;
}

/**
 * The line under "Your takes" on the piece screen: how the newest take went
 * and when, "Rushed in the middle · 3 days ago", in the words of the page the
 * row opens (`takeRowTitle`, `takeDateLabel`), so the two cannot disagree.
 *
 * **It replaced the count** ("7 since Oct 25"). A count says how much; a
 * musician opening a piece is about to play it, and wants to know how it went
 * last time. This screen had the takes loaded and did not say (the reviews of
 * 2026-11-12). The count still heads the page behind the row.
 *
 * The count is the fallback when the newest take is not in hand, and a piece
 * nobody has recorded gets null, which means no row at all.
 */
export function lastTakeLine(history: PieceHistory, now: Date = new Date()): string | null {
  if (history.takes === 0) {
    return null;
  }
  const newest = history.recent[0];
  if (!newest) {
    return historyCount(history);
  }
  return [takeRowTitle(newest), takeDateLabel(newest.recordedAt, now)]
    .filter(Boolean)
    .join(' · ');
}
