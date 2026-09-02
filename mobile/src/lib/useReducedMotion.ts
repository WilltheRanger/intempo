import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { usePreferences } from '../data/preferences';

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
let systemReducedMotion = false;
let listening = false;
const listeners = new Set<() => void>();

function publishSystemPreference(value: boolean): void {
  if (systemReducedMotion === value) {
    return;
  }
  systemReducedMotion = value;
  listeners.forEach((listener) => listener());
}

function startListening(): void {
  if (listening) {
    return;
  }
  listening = true;

  // One platform read and one listener for the app. Previously every animated
  // Library row registered both; a long repertoire did accessibility work at
  // exactly the moment its entrance and scrolling needed the main thread.
  void AccessibilityInfo.isReduceMotionEnabled().then(publishSystemPreference);
  AccessibilityInfo.addEventListener(
    'reduceMotionChanged',
    publishSystemPreference,
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startListening();
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return systemReducedMotion;
}

export function useReducedMotion(): boolean {
  const preferred = usePreferences().reduceMotion;
  const reduceMotion = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return reduceMotion || preferred;
}
