import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { systemPreference } from '../systemPreference';

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
 * Built on `systemPreference`, which `useReducedMotion` also uses: one platform
 * read and one listener for the whole app, published through
 * `useSyncExternalStore`. Every glass surface subscribes, and a tab bar plus
 * four buttons registering five accessibility listeners between them is the
 * cost that shape avoids. This file used to say it was "shaped exactly like
 * `useReducedMotion`" and carry its own copy of the shape.
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

const systemReducedTransparency = systemPreference((publish) => {
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
    publish(media.matches);
    media.addEventListener('change', (event) => {
      publish(event.matches);
    });
    return;
  }

  // Never allowed to throw outward: a platform without the switch should leave
  // the material as it is, not take the screen down with it.
  AccessibilityInfo.isReduceTransparencyEnabled()
    .then(publish)
    .catch(() => {});
  AccessibilityInfo.addEventListener('reduceTransparencyChanged', publish);
});

export function useReducedTransparency(): boolean {
  return useSyncExternalStore(
    systemReducedTransparency.subscribe,
    systemReducedTransparency.getSnapshot,
    systemReducedTransparency.getSnapshot,
  );
}
