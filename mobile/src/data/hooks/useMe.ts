import { useQuery } from '@tanstack/react-query';

import { musicianSource } from '../sources';
import type { Musician } from '../types';

export const meKeys = {
  all: ['me'] as const,
};

/**
 * The signed-in musician.
 *
 * This used to carry an instruction: *"keep it the first authenticated request
 * after sign-in"*, because `/v1/me` created the `public.users` row and writes
 * referencing it failed until it had. That was a race the client could not
 * win — `TodayScreen` fires five queries at once — and EDIT_LOG records the
 * `scores_user_id_fkey` 500 it produced.
 *
 * **The ordering is no longer the client's problem.** Every endpoint that
 * writes a row referencing `users(id)` provisions it first
 * (`backend/app/services/provisioning.py`), so this is now an ordinary read
 * and can be called whenever it is convenient.
 */
export function useMe() {
  return useQuery<Musician>({
    queryKey: meKeys.all,
    queryFn: () => musicianSource.getMusician(),
    // The tier gates paid features; don't let a stale value linger all session.
    staleTime: 5 * 60 * 1000,
  });
}
