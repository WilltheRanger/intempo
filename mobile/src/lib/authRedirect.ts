import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

/**
 * Where an emailed link should send someone back to.
 *
 * Supabase puts this in the mail it sends. Without it the link lands on the
 * project's Site URL — a Supabase page, not the app — which is why every
 * emailed link in this app was previously a dead end: the reset screen said
 * "a link to set a new password is on its way" and following it could not
 * finish the reset.
 *
 * Two platforms, two shapes:
 *
 * - **Web** returns the origin the app is being served from, so the link comes
 *   back to the same deployment that sent it. Hardcoding one would send a
 *   preview build's mail to production.
 * - **Native** returns the app's own scheme (`intempo://`), registered in
 *   `app.json`. `Linking.createURL` builds it, and in Expo Go it produces the
 *   `exp://` form instead — which is what makes this testable before there is
 *   a standalone build.
 *
 * Whatever this returns must also be listed under **Redirect URLs** in the
 * Supabase dashboard. Supabase rejects any redirect it hasn't been told about
 * and silently falls back to the Site URL, which looks exactly like this
 * feature not working.
 */
export function authRedirectUrl(): string | undefined {
  if (Platform.OS === 'web') {
    // `location` is absent when a web build is prerendered rather than served,
    // and `undefined` is the right answer then: Supabase falls back to the
    // Site URL, which is better than a redirect to "undefined".
    return typeof window === 'undefined' ? undefined : window.location.origin;
  }
  return Linking.createURL('/');
}

export type AuthRedirectPayload =
  | {
      kind: 'session';
      accessToken: string;
      refreshToken: string;
      recovery: boolean;
    }
  | { kind: 'error'; message: string }
  /** An informational return with no session in it — see `isEmailChangeHalfway`. */
  | { kind: 'message'; message: string };

/**
 * Reads the implicit-grant callback Supabase sends to a native deep link.
 *
 * The auth client parses `window.location` on web. A phone has no browser URL
 * for it to inspect: Expo delivers the same query and fragment through
 * `Linking`, so the app has to extract the session itself. Query values win,
 * matching auth-js's browser parser.
 *
 * Null means an ordinary app link such as `intempo://pieces/123`; auth must
 * never swallow those merely because they use the same scheme.
 */
export function authRedirectPayload(url: string): AuthRedirectPayload | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const params = new URLSearchParams(
    parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash,
  );
  parsed.searchParams.forEach((value, key) => params.set(key, value));

  const providerError = params.get('error_description') ?? params.get('error');
  if (providerError) {
    return { kind: 'error', message: providerError };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    const message = params.get('message');
    return message ? { kind: 'message', message } : null;
  }

  return {
    kind: 'session',
    accessToken,
    refreshToken,
    recovery: params.get('type') === 'recovery',
  };
}

/**
 * Whether Supabase is saying the first of two email-change links was followed.
 *
 * With "Secure email change" on — Supabase's default — moving an account to a
 * new address takes a link in **both** inboxes. Following the first comes back
 * with `#message=Confirmation link accepted. Please proceed to confirm link
 * sent to the other email` and no session, and the app used to ignore it: the
 * musician landed on the Library with no word that anything had happened, or
 * that a second link was waiting.
 */
export function isEmailChangeHalfway(message: string): boolean {
  return /confirmation link accepted/i.test(message) && /other email/i.test(message);
}

/**
 * Where the web app should start when an address is the halfway return.
 *
 * **Rewritten before the navigator reads the address, not navigated to after.**
 * On the web the navigator takes its first screen from the address while it
 * mounts; a `navigate` sent from an effect a moment later was undone by that
 * (measured on the stub API: the call was made and the Library stayed). So the
 * address is changed first, to the screen that says what is left, and the app
 * simply starts there.
 */
export const EMAIL_CHANGE_HALFWAY_PATH = '/account/email?halfway=1';

export function halfwayStartPath(href: string): string | null {
  const payload = authRedirectPayload(href);
  return payload?.kind === 'message' && isEmailChangeHalfway(payload.message)
    ? EMAIL_CHANGE_HALFWAY_PATH
    : null;
}
