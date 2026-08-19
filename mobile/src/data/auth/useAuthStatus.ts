import { useEffect, useState } from 'react';

import { IS_LIVE_BACKEND } from '../environment';
import { getSupabaseClient } from './session';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut' | 'recovering';

/**
 * Whether there's a session, kept in step with Supabase.
 *
 * The stored session is read once on mount and then followed with
 * `onAuthStateChange`, which covers sign-in, sign-out, token refresh, and a
 * session restored from storage on a cold start.
 *
 * **A fixture build reports `signedIn` and shows no gate.** Sample data
 * belongs to nobody, so there is nothing to sign in to and a form that cannot
 * succeed would be the only thing standing between a reader and the app.
 *
 * The predicate is `IS_LIVE_BACKEND` rather than "are the Supabase vars set",
 * and the difference is a real state: a build with Supabase credentials but no
 * API host would otherwise demand a sign-in and then serve fixtures — the gate
 * would be theatre, guarding data that isn't the account's. Tying both to one
 * predicate means the gate is present exactly when there is something behind
 * it. A shipped build that loses its env vars degrades to fixtures rather than
 * to unauthenticated access to live data, because `apiFetch` then has no host
 * to talk to either.
 */
export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>(() =>
    IS_LIVE_BACKEND ? 'loading' : 'signedIn',
  );

  useEffect(() => {
    if (!IS_LIVE_BACKEND) {
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }
      // Never downgrades `recovering`. This promise and the auth listener race
      // on a reset link — `detectSessionInUrl` establishes the session and
      // fires `PASSWORD_RECOVERY` while this is still in flight — and whichever
      // lands second wins. Resolving to a plain "signedIn" here would drop
      // someone into Today with the reset they clicked on unfinished.
      setStatus((current) =>
        current === 'recovering'
          ? 'recovering'
          : data.session
            ? 'signedIn'
            : 'signedOut',
      );
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        setStatus('signedOut');
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        setStatus('recovering');
        return;
      }
      // `USER_UPDATED` is what arrives when the new password is saved, which is
      // the moment recovery is finished. Every other event with a session —
      // including the token refreshes that keep arriving while the set-password
      // screen is open — must not knock us out of `recovering` early, or the
      // screen vanishes mid-typing.
      setStatus((current) =>
        current === 'recovering' && event !== 'USER_UPDATED'
          ? 'recovering'
          : 'signedIn',
      );
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return status;
}
