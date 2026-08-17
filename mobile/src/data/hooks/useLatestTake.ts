import { useQuery } from '@tanstack/react-query';

import { takeSource } from '../sources';
import type { TakeResult } from '../types';

export const takeKeys = {
  all: ['takes'] as const,
  latest: () => [...takeKeys.all, 'latest'] as const,
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
