import { useQuery } from '@tanstack/react-query';

import { getMe } from '../api/me';
import type { Musician } from '../types';

export const meKeys = {
  all: ['me'] as const,
};

/**
 * The signed-in musician.
 *
 * This is also the app's provisioning call — the backend creates the
 * `public.users` row on first touch, and other endpoints fail until it has
 * run. Keep it as the first authenticated request after sign-in.
 */
export function useMe() {
  return useQuery<Musician>({
    queryKey: meKeys.all,
    queryFn: async () => {
      const me = await getMe();
      return {
        id: me.id,
        email: me.email,
        tier: me.tier,
        role: me.role,
        studioId: me.studio_id,
      };
    },
    // The tier gates paid features; don't let a stale value linger all session.
    staleTime: 5 * 60 * 1000,
  });
}
