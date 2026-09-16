import type { TakeResult } from '../../data/types';
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

export interface LastTakeCue {
  /** The pipeline's own sentence about that take. */
  headline: string;
  /** So the card can offer to open it. */
  takeId: string;
}

/**
 * What happened last time, for the card that says what to do next.
 *
 * **Only a take that produced a verdict.** A failed run's every field below
 * `failure` is a placeholder, and a take the pipeline could not use carries a
 * sentence about the recording rather than about the playing — "your recording
 * is completely silent" is not a thing to work on next time, it is a thing
 * that already went wrong.
 *
 * Newest first is what the source returns, so the first usable one is the most
 * recent — not simply `recent[0]`, which would go silent for a whole piece
 * because the last attempt did not upload.
 */
export function lastTakeCue(recent: readonly TakeResult[]): LastTakeCue | null {
  const usable = recent.find(
    (take) => take.failure === null && take.status === 'ok' && take.headline,
  );
  return usable ? { headline: usable.headline, takeId: usable.id } : null;
}
