import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { usePreferences } from '../data/preferences';
import { systemPreference } from './systemPreference';

/**
 * Whether animation should be held back — because the OS says so, or because
 * the musician asked for it in the app.
 *
 * React Native has no `prefers-reduced-motion` media query — it's an async
 * accessibility read plus a change listener, so every animated component needs
 * this rather than a CSS-style guard.
 *
 * The two sources are OR'd, never overridden: the in-app switch can add
 * restraint but can't take it away from someone whose device already asked.
 */
const systemReducedMotion = systemPreference((publish) => {
  // One platform read and one listener for the app — see `systemPreference`.
  void AccessibilityInfo.isReduceMotionEnabled().then(publish);
  AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
});

export function useReducedMotion(): boolean {
  const preferred = usePreferences().reduceMotion;
  const reduceMotion = useSyncExternalStore(
    systemReducedMotion.subscribe,
    systemReducedMotion.getSnapshot,
    systemReducedMotion.getSnapshot,
  );
  return reduceMotion || preferred;
}
