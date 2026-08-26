/**
 * Whether this device has a camera worth photographing a page of music with.
 *
 * **Not "is this the web build".** A phone browser is `Platform.OS === 'web'`
 * and its rear camera is the best camera in this whole product — twelve
 * megapixels, autofocus, held a foot from the page. A laptop is also `web` and
 * its camera is a 720p webcam pointed at the person, not the desk.
 *
 * The difference is measurable and it decides whether a scan can work at all.
 * Measured on the musician's own page: at 4284x5712 its staff lines are 25 px
 * apart and it reads; the same page at 1280x960 is 4 px and `too_small_to_read`
 * refuses it, correctly. A webcam cannot resolve the gap between staff lines,
 * so offering it as a way to scan a page is offering a route that ends in a
 * refusal every time — and until this, the refusal's own advice was "use a
 * phone rather than a webcam", pointing away from a button the app had just
 * shown them.
 */

export interface DeviceHints {
  /** `Platform.OS`. */
  os: string;
  /** `navigator.userAgentData?.mobile`, where the browser reports it. */
  mobileHint?: boolean;
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints?: number;
  /** `matchMedia('(pointer: coarse)').matches`. */
  coarsePointer?: boolean;
}

export function cameraCanPhotographAPage(hints: DeviceHints): boolean {
  // A real app build is on a phone or a tablet. There is no desktop target.
  if (hints.os !== 'web') {
    return true;
  }
  // The browser's own answer, when it has one. Chrome and Edge report it;
  // Safari and Firefox do not, which is why it cannot be the only signal.
  if (typeof hints.mobileHint === 'boolean') {
    return hints.mobileHint;
  }
  // **A touchscreen is the fallback, not the definition.** A touchscreen laptop
  // is therefore treated as a phone and keeps the camera button, which is the
  // safe direction: the cost is one useless option on an unusual device, and
  // the cost of guessing the other way is taking the camera away from a phone,
  // which is the only way most people will ever scan anything.
  return Boolean(hints.maxTouchPoints) || hints.coarsePointer === true;
}

/**
 * Reads the hints from whatever is actually running, without assuming a DOM.
 *
 * Every lookup is guarded. This runs inside a React Native bundle where
 * `navigator` may be a shim with none of these on it, and a screen that throws
 * while deciding whether to show a button is worse than either answer.
 */
export function deviceHints(os: string): DeviceHints {
  const nav: Record<string, unknown> =
    typeof navigator === 'undefined' ? {} : (navigator as never);
  const agent = nav.userAgentData as { mobile?: boolean } | undefined;

  let coarsePointer: boolean | undefined;
  try {
    coarsePointer =
      typeof matchMedia === 'function'
        ? matchMedia('(pointer: coarse)').matches
        : undefined;
  } catch {
    coarsePointer = undefined;
  }

  return {
    os,
    mobileHint: typeof agent?.mobile === 'boolean' ? agent.mobile : undefined,
    maxTouchPoints:
      typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : undefined,
    coarsePointer,
  };
}
