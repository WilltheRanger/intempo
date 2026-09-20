import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';

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
  const query = useQuery<Musician>({
    queryKey: meKeys.all,
    queryFn: () => musicianSource.getMusician(),
    // The tier gates paid features; don't let a stale value linger all session.
    staleTime: 5 * 60 * 1000,
  });

  /**
   * **Fetch the photograph before the screen that shows it exists.**
   *
   * The Profile screen rendered the placeholder mark and then swapped to the
   * photograph a moment later, which reads as the screen loading in two
   * stages. The URL was never the problem - Today already calls this hook, so
   * by the time Profile opens it is cached - the bytes were. So they are
   * fetched here, at the first screen that knows the URL, rather than at the
   * one that draws it.
   *
   * `Image.prefetch` is idempotent and already-cached URLs cost nothing, which
   * is what makes it safe to call from a hook several screens use. Failures
   * are swallowed: this is an optimisation, and a musician on a bad connection
   * should get the placeholder and no error, exactly as before.
   */
  const avatarUrl = query.data?.avatarUrl ?? null;
  useEffect(() => {
    if (!avatarUrl) {
      return;
    }
    void Image.prefetch(avatarUrl).catch(() => {});
  }, [avatarUrl]);

  return query;
}
