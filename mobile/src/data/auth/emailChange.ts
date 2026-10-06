import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { halfwayStartPath } from '../../lib/authRedirect';
import { setAuthRedirectNotice } from './redirectNotice';

/**
 * The first of two email-change links has been followed.
 *
 * Set when that return arrives (`useAuthStatus`), and taken once by the signed-
 * in app, which opens Change email to say what is left. A module store, like
 * `redirectNotice`, because the link is read before any screen exists.
 */
export const EMAIL_CHANGE_HALFWAY =
  'One link down, one to go. Follow the link in your other inbox to finish changing your address.';

let halfway = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEmailChangeHalfway(): boolean {
  return useSyncExternalStore(subscribe, () => halfway, () => false);
}

export function noteEmailChangeHalfway(): void {
  if (halfway) return;
  halfway = true;
  listeners.forEach((listener) => listener());
}

/** True once per return: the screen that shows it clears it. */
export function takeEmailChangeHalfway(): boolean {
  if (!halfway) return false;
  halfway = false;
  listeners.forEach((listener) => listener());
  return true;
}

/**
 * On the web, turn the halfway return into the address of the screen that
 * explains it, before the navigator reads the address (`halfwayStartPath`).
 *
 * Signed in, the app then starts on Change email with `halfway`. Signed out,
 * the sign-in screen shows the same sentence, and after signing in the app
 * starts where the address says. Called once at module scope in `App.tsx`.
 */
export function takeEmailChangeHalfwayFromAddress(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const path = halfwayStartPath(window.location.href);
  if (!path) return;
  window.history.replaceState(window.history.state, '', path);
  setAuthRedirectNotice(EMAIL_CHANGE_HALFWAY);
}
