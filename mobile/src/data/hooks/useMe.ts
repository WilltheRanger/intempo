import { useQuery } from '@tanstack/react-query';

import { musicianSource } from '../sources';
import type { Musician } from '../types';

export const meKeys = {
  all: ['me'] as const,
};

/**
 * The signed-in musician.
 *
 * Against the real backend this is also the app's provisioning call — it
 * creates the `public.users` row on first touch, and other endpoints fail
 * until it has run. Keep it as the first authenticated request after sign-in.
 */
export function useMe() {
  return useQuery<Musician>({
    queryKey: meKeys.all,
    queryFn: () => musicianSource.getMusician(),
    // The tier gates paid features; don't let a stale value linger all session.
    staleTime: 5 * 60 * 1000,
  });
}
