import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Whether the person has asked their device to cut back on translucency.
 *
 * The material this app floats its controls on is a *custom* element — an
 * `expo-blur` view on native, a `backdrop-filter` stack on the web — not a
 * system bar. Apple's rule for that case is explicit: a standard component
 * adapts to Reduce Transparency on its own, and anything custom has to provide
 * the fallback itself. Nothing here did, so the setting was inert on every
 * surface the app draws.
 *
 * Shaped exactly like `useReducedMotion`: one platform read and one listener
 * for the whole app, published through `useSyncExternalStore`. Every glass
 * surface subscribes, and a tab bar plus four buttons registering five
 * accessibility listeners between them is the cost that shape avoids.
 *
 * Two platforms, two sources:
 *
 * - **Native** — `isReduceTransparencyEnabled` plus `reduceTransparencyChanged`.
 *   iOS answers it; Android has no equivalent switch and answers false, which
 *   is the right answer there since the blur does not land on Android anyway.
 * - **Web** — `prefers-reduced-transparency`, which is the same iOS setting
 *   surfaced to the browser, and which the deployed build is what actually
 *   reaches people.
 */

/** The web build's equivalent of the native setting. */
const WEB_QUERY = '(prefers-reduced-transparency: reduce)';

let systemReducedTransparency = false;
let listening = false;
const listeners = new Set<() => void>();

function publishSystemPreference(value: boolean): void {
  if (systemReducedTransparency === value) {
    return;
  }
  systemReducedTransparency = value;
  listeners.forEach((listener) => listener());
}

function startListening(): void {
  if (listening) {
    return;
  }
  listening = true;

  if (Platform.OS === 'web') {
    // Guarded rather than assumed: this module is imported by components that
    // render under Vitest, where there is no `window`, and by older browsers
    // that have `matchMedia` but not this query — which they report as a
    // non-matching list rather than by throwing.
    const media =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(WEB_QUERY)
        : null;
    if (!media) {
      return;
    }
    publishSystemPreference(media.matches);
    media.addEventListener('change', (event) => {
      publishSystemPreference(event.matches);
    });
    return;
  }

  // Never allowed to throw outward: a platform without the switch should leave
  // the material as it is, not take the screen down with it.
  AccessibilityInfo.isReduceTransparencyEnabled()
    .then(publishSystemPreference)
    .catch(() => {});
  AccessibilityInfo.addEventListener(
    'reduceTransparencyChanged',
    publishSystemPreference,
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startListening();
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return systemReducedTransparency;
}

export function useReducedTransparency(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
