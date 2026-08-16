import { useQuery } from '@tanstack/react-query';

import { insightsSource } from '../sources';
import type { PracticeInsights } from '../types';

export const insightsKeys = {
  all: ['insights'] as const,
};

/** Aggregate practice history for the Insights tab. */
export function useInsights() {
  return useQuery<PracticeInsights | null>({
    queryKey: insightsKeys.all,
    queryFn: () => insightsSource.getInsights(),
  });
}
