import { useSyncExternalStore } from 'react';

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
