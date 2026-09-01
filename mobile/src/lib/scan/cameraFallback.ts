/**
 * What the scanner says, and offers, when it cannot show a viewfinder.
 *
 * **The screen used to be a dead end with directions on it.** Refused camera
 * access read: *"InTempo does not have camera access. Turn it on in your device
 * settings, or add the piece by hand instead."* Two routes named, neither
 * reachable from the screen saying it — there is no settings control here, and
 * the one button in the corner goes to image import, not to typing a piece in.
 * That is the rule this project has broken before and written down:
 * **advice must name a route that exists in this app**.
 *
 * It is also platform-wrong. "Device settings" is right on a phone with the app
 * installed and meaningless in a browser, where the permission belongs to the
 * site and lives behind the address bar. And on the web there is a better
 * answer than any settings screen: the phone's own camera app needs no
 * `getUserMedia` grant at all, so a musician whose browser has refused the
 * camera can still photograph the page.
 *
 * A rule, in a module, because the screen it serves is a `.tsx` and this
 * project has no React Native testing library — see `DECISIONS.md`, 2026-08-24.
 */

export interface CameraState {
  /**
   * `null` while the permission answer is still coming.
   *
   * Distinct from `false` on purpose: "no" and "not yet" are different
   * sentences, and showing the refusal copy for the half-second before the
   * answer arrives makes a working camera look broken.
   */
  granted: boolean | null;
  /** False once the system will never show its prompt again. */
  canAskAgain: boolean;
  /** `Platform.OS`. */
  os: string;
}

export type FallbackRoute = 'systemCamera' | 'import';

export interface CameraFallback {
  message: string;
  /** The one control to offer beneath it, or null when there is nothing to do. */
  action: { label: string; route: FallbackRoute } | null;
}

/**
 * The message and the way out, or null when the camera is working.
 *
 * Null means "show the viewfinder" — the caller has nothing to render, which is
 * the normal case and should stay the shortest branch.
 */
export function cameraFallback({
  granted,
  canAskAgain,
  os,
}: CameraState): CameraFallback | null {
  if (granted === true) {
    return null;
  }
  if (granted === null) {
    return { message: 'Starting the camera…', action: null };
  }
  if (canAskAgain) {
    // The system prompt is still coming. Anything offered here would be a
    // second decision on top of the one already on screen.
    return {
      message: 'InTempo needs your camera to photograph sheet music.',
      action: null,
    };
  }

  if (os === 'web') {
    return {
      // Named as the browser's refusal, not the app's failure, because that is
      // what it is and because it tells them where to change it if they want to.
      message:
        'Your browser is not letting InTempo use the camera. Your phone’s camera app can still photograph the page.',
      action: { label: 'Open the camera app', route: 'systemCamera' },
    };
  }

  return {
    message:
      'InTempo does not have camera access. You can turn it on in Settings, or use photographs you have already taken.',
    action: { label: 'Choose images instead', route: 'import' },
  };
}
