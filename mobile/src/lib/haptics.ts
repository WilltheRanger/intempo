import * as Haptics from 'expo-haptics';

import { preferences } from '../data/preferences';

/**
 * Impact feedback, gated on the musician's preference.
 *
 * Every haptic in the app goes through here rather than calling `expo-haptics`
 * directly, so the setting can't be true in one place and ignored in another.
 * Read synchronously — this is called from press handlers, which can't wait.
 */
export function impact(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void {
  if (!preferences.current().haptics) {
    return;
  }
  void Haptics.impactAsync(style);
}

/**
 * The "that worked" tap: two quick pulses, iOS's own success pattern.
 *
 * For a thing the musician sent and the app received — an answer to "What
 * did you hear?" — where a single impact reads as a press rather than as the
 * press having done something. Gated the same way as `impact`.
 */
export function success(): void {
  if (!preferences.current().haptics) {
    return;
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export { ImpactFeedbackStyle } from 'expo-haptics';
