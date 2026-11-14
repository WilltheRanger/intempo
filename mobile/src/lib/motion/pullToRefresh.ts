/**
 * Pull to refresh on the web build, the way an iPhone does it.
 *
 * **It did nothing.** Library and Insights asked for pull-to-refresh, and on a
 * phone they get `RefreshControl`; react-native-web's `RefreshControl` is a
 * plain view that throws `onRefresh` away (`RefreshControl/index.js`), so on
 * the web build — which is what the owner uses — a pull bounced and nothing
 * happened (2026-11-13).
 *
 * **Safari already draws the pull.** A scroller in WebKit on iOS keeps its
 * rubber band unless `overscroll-behavior` is `none`, and while it is pulled
 * past the top its `scrollTop` goes below zero. That is what Ionic's iOS
 * refresher reads (`refresher.tsx`), and what this does: the gap the band
 * opens is where the spinner is drawn, its ticks arriving one by one as the
 * pull lengthens, and a long enough pull starts the refresh — the way
 * UIRefreshControl fires mid-pull, not on release. The page is then held a
 * spinner's height down until the refresh is over.
 *
 * A browser without a rubber band (Chromium, Android) never reports a
 * negative offset, and nothing changes there.
 */

/** How far the pull goes before the spinner starts to show. */
export const PULL_START = 16;

/** How far the pull goes to start a refresh. UIRefreshControl's, and Flutter's: about 100. */
export const PULL_TRIGGER = 100;

/** The room the page is held down by while it refreshes: the spinner and its air. */
export const REFRESH_HOLD = 56;

/**
 * The shortest time a pulled refresh is shown for.
 *
 * A refresh that answers at once — a page already up to date, a cached
 * library — would otherwise flash the spinner for a frame, which reads as the
 * pull having done nothing. UIRefreshControl spins at least this long too.
 */
export const MIN_REFRESH_MS = 600;

/** UIActivityIndicatorView's ticks. */
export const SPINNER_TICKS = 8;

/** How far the page is pulled past its top, from the scroller's offset. */
export function pullDistance(scrollTop: number): number {
  return scrollTop < 0 ? -scrollTop : 0;
}

/** How much of the way to a refresh the pull is: 0 until it shows, 1 at the trigger. */
export function pullProgress(pull: number): number {
  if (pull <= PULL_START) {
    return 0;
  }
  return Math.min(1, (pull - PULL_START) / (PULL_TRIGGER - PULL_START));
}

/** How many of the spinner's ticks are drawn, for a pull's progress. */
export function ticksShown(progress: number): number {
  return Math.min(SPINNER_TICKS, Math.ceil(progress * SPINNER_TICKS));
}

/**
 * Whether this pull starts a refresh.
 *
 * Once per pull: `armed` is cleared when it fires and set again only when the
 * page is back at its top, so holding a long pull does not refresh twice, and
 * a refresh already running is not started again.
 */
export function startsRefresh(pull: number, armed: boolean, refreshing: boolean): boolean {
  return armed && !refreshing && pull >= PULL_TRIGGER;
}
