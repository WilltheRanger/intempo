import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { IS_LIVE_BACKEND } from '../environment';
import { setAuthRedirectNotice } from './redirectNotice';
import { consumeAuthRedirect, getSupabaseClient } from './session';

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
/**
 * How long to wait for the stored session before giving up and showing the
 * sign-in screen.
 *
 * The same reasoning as `FONT_TIMEOUT_MS` in `App.tsx`, and the same failure it
 * prevents: `RootNavigator` renders a bare ivory rectangle while this is
 * `loading`, so a `getSession()` that never settles — a wedged storage read, a
 * Supabase client that never resolves — turned the whole app into a blank
 * screen with nothing to tap. Signing in again is a recoverable annoyance; a
 * blank screen is an outage. On any working deployment this never fires.
 */
const SESSION_TIMEOUT_MS = 8000;

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
    // Preserve the non-null client across the async deep-link closure. TypeScript
    // cannot carry the guard above into a function that may run later.
    const authClient = supabase;

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
      // Any real session resolves an earlier dead-link notice, including a
      // password sign-in that the musician uses instead of requesting mail.
      setAuthRedirectNotice(null);
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

    // auth-js reads callback tokens from `window.location` on web. Native
    // receives the same link through Linking, and detectSessionInUrl is off
    // there because no browser URL exists. Handle both a cold-opened link and
    // one tapped while InTempo is already running, once each.
    const handledLinks = new Set<string>();
    async function handleLink(url: string) {
      if (handledLinks.has(url)) {
        return;
      }
      handledLinks.add(url);
      try {
        const outcome = await consumeAuthRedirect(url);
        if (!active || outcome === 'ignored') {
          return;
        }
        setAuthRedirectNotice(null);
        setStatus(outcome === 'recovery' ? 'recovering' : 'signedIn');
      } catch {
        // A used or expired mail must not revoke a session that is already
        // valid. Signed-out users return to the form with an explanation and
        // its existing resend, password-reset, and magic-link routes.
        const { data: current } = await authClient.auth.getSession();
        if (!active || current.session) {
          return;
        }
        setAuthRedirectNotice(
          'That email link has expired or cannot be used. Request a new link below, or sign in with your password.',
        );
        setStatus('signedOut');
      }
    }

    let linkSubscription: ReturnType<typeof Linking.addEventListener> | null = null;
    if (Platform.OS !== 'web') {
      void Linking.getInitialURL().then((url) => {
        if (url) {
          void handleLink(url);
        }
      });
      linkSubscription = Linking.addEventListener('url', ({ url }) => {
        void handleLink(url);
      });
    }

    // Only ever resolves a *stuck* load. Once anything real has been decided
    // this is a no-op, and it never overrides `recovering`.
    const timeout = setTimeout(() => {
      if (active) {
        setStatus((current) => (current === 'loading' ? 'signedOut' : current));
      }
    }, SESSION_TIMEOUT_MS);

    return () => {
      active = false;
      clearTimeout(timeout);
      data.subscription.unsubscribe();
      linkSubscription?.remove();
    };
  }, []);

  return status;
}
