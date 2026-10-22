import type { QueryClient } from '@tanstack/react-query';

import { insightsKeys } from './useInsights';
import { meKeys } from './useMe';
import { pieceKeys } from './usePieces';
import { takeKeys } from './useLatestTake';

/**
 * Everything a finished take makes stale, marked stale together.
 *
 * **One finished take changes four answers.** The account's remaining monthly
 * allowance (`/v1/me`), the take history (`takeKeys`, which `useLatestTake`
 * says is "invalidated with the rest of `takeKeys.all` when a take finishes"),
 * the Insights trend, and the pieces' last-practised line and the Continue
 * band. Only the first was refreshed, and the tabs stay mounted with
 * `refetchOnWindowFocus` off, so after a take the Library and Insights kept
 * showing the practice from before it until the app was restarted.
 *
 * Shared by the Record screen and the background drain, which sends takes
 * recorded out of signal and was refreshing nothing at all.
 */
export async function refreshAfterTake(client: QueryClient): Promise<void> {
  await Promise.all(
    [meKeys.all, takeKeys.all, insightsKeys.all, pieceKeys.all].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}
