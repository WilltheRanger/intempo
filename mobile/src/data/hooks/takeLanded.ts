import type { QueryClient } from '@tanstack/react-query';

import { insightsKeys } from './useInsights';
import { takeKeys } from './useLatestTake';
import { meKeys } from './useMe';
import { pieceKeys } from './usePieces';

/**
 * Everything a finished take changes, marked stale in one place.
 *
 * **Until 2026-10-20 nothing did this.** The Record screen refreshed only the
 * allowance, and the only code that invalidated takes or insights was deleting
 * a piece. So Insights went on counting "1 more take to go" from the copy it
 * already held — fresh for `STALE_TIME_MS`, then waiting for a refocus — and a
 * take that had been analysed showed up about a minute later. Today's latest
 * take, the Library's last-played line and order (`lastPracticedAt`) and a
 * piece's history were stale the same way.
 *
 * Three callers, because a take lands three ways: the Record screen after its
 * own wait, the drain sending one recorded out of signal, and the Library
 * finding a remembered analysis finished after the app was closed on it. All
 * are after the analysis has finished, which is what makes the refetch worth
 * doing — before it, the take would be fetched still running and cached that
 * way.
 */
export function takeLanded(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: takeKeys.all }),
    client.invalidateQueries({ queryKey: insightsKeys.all }),
    // The library sorts and labels pieces by `lastPracticedAt`, which this
    // take just moved.
    client.invalidateQueries({ queryKey: pieceKeys.all }),
    // `/v1/me` carries the monthly allowance, which this take just spent.
    client.invalidateQueries({ queryKey: meKeys.all }),
  ]).then(() => undefined);
}
