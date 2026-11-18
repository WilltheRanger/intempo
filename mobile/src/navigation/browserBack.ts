/**
 * Whether the browser has just animated a history change itself.
 *
 * **Safari's edge swipe plays its own transition**, from a snapshot of the page
 * the musician is returning to, and then hands the app a `popstate`. The app
 * then played its own entrance on top (`StackScene`), so every swipe back was
 * the swipe, a blank ivory frame, and a second slide (measured 2026-11-12: the
 * Library's first frame after `history.back()` was opacity 0 at −32).
 *
 * `PopStateEvent.hasUAVisualTransition` is the browser saying it already drew
 * the change. Only then is the app's entrance skipped: an in-app "‹ Back"
 * keeps its slide, and a browser that does not report the flag behaves as
 * before. Headless Chromium never sets it, so this is confirmed on a phone,
 * not by the walk.
 *
 * Registered at module scope, so it runs before React Navigation's own
 * `popstate` listener, which is added when the container mounts and is what
 * moves the stack.
 */
/** Long enough to cover the render the stack change causes, and no longer. */
export const BROWSER_TRANSITION_WINDOW_MS = 600;

let animatedAt = Number.NEGATIVE_INFINITY;

/** The rule, without the clock: did the browser animate within the window? */
export function browserJustAnimated(now: number, at: number): boolean {
  return now - at >= 0 && now - at < BROWSER_TRANSITION_WINDOW_MS;
}

/** Whether the stack change being rendered now was already animated by the browser. */
export function stackChangeAnimatedByBrowser(): boolean {
  return browserJustAnimated(now(), animatedAt);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// No `react-native` import, so the rule above can be tested: a phone's
// `window` has no `addEventListener`, which is the platform check.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('popstate', (event) => {
    if ((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) {
      animatedAt = now();
    }
  });
}
