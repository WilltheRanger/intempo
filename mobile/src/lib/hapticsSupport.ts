/**
 * Whether this device can tap the finger, and how.
 *
 * **iPhone web has no vibration API**, and the only haptic Safari will play
 * is the one built into its switch control: an `<input type="checkbox"
 * switch>` toggled by a person's own tap (Safari 18: "added haptic feedback
 * for `<input type=checkbox switch>` on iOS"). `expo-haptics` reached it by
 * clicking a hidden switch from code, which current WebKit no longer honours
 * — a switch plays its haptic only for a trusted click made during a user's
 * gesture (`CheckboxInputType.cpp`; the `ios-haptics` library moved from that
 * to a real tap in its version 3, noting Apple closed the old way in iOS
 * 26.5). So on iPhone the app's taps carry a hidden switch under the finger
 * (`HapticTap`), and nothing else can make the phone tap at all: not a
 * timer, so not a metronome; not a refresh threshold; not a drag.
 *
 * The rules are here, without the browser, so they can be tested.
 */

export interface HapticEnvironment {
  /** The browser knows `<input type="checkbox" switch>`: Safari 17.4 and later. */
  switchInput: boolean;
  /** A finger, not a mouse: a phone or a tablet. */
  coarsePointer: boolean;
  /** `navigator.vibrate` exists: Android's browsers, none of Apple's. */
  vibrate: boolean;
}

/**
 * Taps carry a hidden switch under the finger: a touch screen whose browser
 * has the switch and no vibration API — Safari on an iPhone.
 */
export function tapsCarrySwitch(environment: HapticEnvironment): boolean {
  return environment.switchInput && environment.coarsePointer && !environment.vibrate;
}

/**
 * The device can tap on a beat, unprompted by a finger: anything but a
 * browser without a vibration API. The haptic metronome is offered only here.
 */
export function canTapOnBeat(environment: HapticEnvironment | null): boolean {
  // Null is a phone app: the platform's own haptics engine.
  return environment === null || environment.vibrate;
}

/**
 * Whether this device can tap on a beat, decided once. True in the phone app
 * and in a browser with a vibration API; false in Safari on an iPhone.
 */
export const DEVICE_TAPS_ON_BEAT = canTapOnBeat(hapticEnvironment());

/** The browser's answers, or null outside a browser. */
export function hapticEnvironment(): HapticEnvironment | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }
  const input = document.createElement('input');
  return {
    switchInput: 'switch' in input,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    vibrate: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
  };
}
