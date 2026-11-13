import * as Haptics from 'expo-haptics';

import { preferences } from '../data/preferences';
import { hapticEnvironment, tapsCarrySwitch } from './hapticsSupport';

/**
 * The web build's haptics: `expo-haptics`, except where the finger carries
 * them itself.
 *
 * **On an iPhone the tap is the haptic** (`hapticsSupport.ts`): the switch
 * under the finger plays it (`HapticTap`), and a call from here would be
 * either ignored, on current iOS, or a second tap on top of the finger's, on
 * an older one. So these do nothing there. Everywhere else — Android's
 * browsers, through `navigator.vibrate` — they are what the phone app does.
 */
const fingerCarriesIt = (() => {
  const environment = hapticEnvironment();
  return environment !== null && tapsCarrySwitch(environment);
})();

export function impact(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void {
  if (fingerCarriesIt || !preferences.current().haptics) {
    return;
  }
  void Haptics.impactAsync(style);
}

export function success(): void {
  if (fingerCarriesIt || !preferences.current().haptics) {
    return;
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export { ImpactFeedbackStyle } from 'expo-haptics';
