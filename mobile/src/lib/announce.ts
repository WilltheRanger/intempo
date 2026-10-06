import { AccessibilityInfo } from 'react-native';

/**
 * Say something to a screen reader without moving its focus.
 *
 * Native has this built in. The web does not — react-native-web's
 * `announceForAccessibility` is an empty function — so every announcement the
 * app made there was dropped without a sound; `announce.web.ts` is the web's.
 */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility?.(message);
}
