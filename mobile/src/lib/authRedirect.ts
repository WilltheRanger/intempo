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
