import { useEffect, useState } from 'react';

import { getSupabaseClient, isAuthConfigured } from './session';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

/**
 * Whether there's a session, kept in step with Supabase.
 *
 * The stored session is read once on mount and then followed with
 * `onAuthStateChange`, which covers sign-in, sign-out, token refresh, and a
 * session restored from storage on a cold start.
 *
 * When Supabase isn't configured this reports `signedIn`. That is deliberate:
 * a build with no auth credentials also has no backend to reach — every
 * screen is on fixtures — so gating it would lock the app behind a form that
 * cannot succeed. The gate protects real sessions; it doesn't stand in for
 * one. If a shipped build ever loses its env vars, it degrades to that same
 * fixture state rather than to unauthenticated access to live data, because
 * `apiFetch` has no host to talk to either.
 */
export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>(() =>
    isAuthConfigured() ? 'loading' : 'signedIn',
  );

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setStatus(data.session ? 'signedIn' : 'signedOut');
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? 'signedIn' : 'signedOut');
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return status;
}
