import { useQuery } from '@tanstack/react-query';

import { takeSource } from '../sources';
import type { TakeResult } from '../types';
import type { PieceHistory } from '../sources/types';

export const takeKeys = {
  all: ['takes'] as const,
  latest: () => [...takeKeys.all, 'latest'] as const,
  recent: (limit: number) => [...takeKeys.all, 'recent', limit] as const,
  history: (pieceId: string) => [...takeKeys.all, 'history', pieceId] as const,
};

/**
 * The most recent finished take, for Today.
 *
 * Deliberately not the same question as `useInsights`. Insights answers "what
 * do I tend to do", over thirty days; this answers "how did last time go",
 * which is what someone opening the app in the morning actually wants and is
 * the one thing a thirty-day mean can never say.
 */
export function useLatestTake() {
  return useQuery<TakeResult | null>({
    queryKey: takeKeys.latest(),
    queryFn: () => takeSource.getLatestTake(),
  });
}


/** Recent finished takes for the Today practice history. */
export function useRecentTakes(limit = 3) {
  return useQuery<TakeResult[]>({
    queryKey: takeKeys.recent(limit),
    queryFn: () => takeSource.getRecentTakes(limit),
  });
}


/**
 * One piece's practice history, for the card on its screen.
 *
 * Keyed by piece, so opening a second piece does not refetch the first — and
 * invalidated with the rest of `takeKeys.all` when a take finishes, which is
 * the only thing that changes it.
 */
export function usePieceHistory(pieceId: string) {
  return useQuery<PieceHistory>({
    queryKey: takeKeys.history(pieceId),
    queryFn: () => takeSource.getPieceHistory(pieceId),
  });
}
