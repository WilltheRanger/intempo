/**
 * Which tabs are built before anyone opens them, in what order, and when.
 *
 * **Every tab was built on its first tap.** React Navigation mounts a tab
 * lazily, so the first visit to Profile, Library or Insights paid for the
 * whole screen — and for its data, which the screen asks for as it mounts —
 * while the musician watched. Measured at 4x CPU slowdown on 2026-09-23: about
 * 300ms from touch to Profile or Library on first open, against 150ms once
 * built. The owner's report was that Profile "still takes time to load".
 *
 * So once Today has drawn, the others are built out of sight, one at a time,
 * with room between them for a tap to land: a finger that arrives mid-build
 * waits for that one tab, not for all three. Library is last because it is the
 * heaviest — it engraves the first system of every piece on the shelf.
 *
 * Mounting a tab also starts its queries, so this is the data prefetch as well:
 * by the time a tab is opened its first answer is usually already in.
 */

export const WARM_ORDER = ['Profile', 'Insights', 'Library'] as const;
export type WarmTab = (typeof WARM_ORDER)[number];

/** After Today has drawn: long enough for its own entrance to finish. */
export const FIRST_WARM_DELAY_MS = 700;
/** Between tabs, so a tap never waits behind more than one build. */
export const BETWEEN_WARMS_MS = 350;

export type Schedule = (run: () => void, afterMs: number) => () => void;

/**
 * Preload each tab in `WARM_ORDER`, spaced out, and return a cancel.
 *
 * `preload` is `navigation.preload`; `schedule` is a timer. Both are passed in
 * so the order and spacing are testable without a navigator or a clock.
 */
export function warmTabs(preload: (tab: WarmTab) => void, schedule: Schedule): () => void {
  let cancelled = false;
  let cancelNext: () => void = () => {};

  const step = (index: number, delay: number) => {
    cancelNext = schedule(() => {
      if (cancelled) {
        return;
      }
      preload(WARM_ORDER[index]);
      if (index + 1 < WARM_ORDER.length) {
        step(index + 1, BETWEEN_WARMS_MS);
      }
    }, delay);
  };
  step(0, FIRST_WARM_DELAY_MS);

  return () => {
    cancelled = true;
    cancelNext();
  };
}

/**
 * Whether to warm at all.
 *
 * Not when the browser says the connection is metered ("Save data"): building
 * three screens also fetches their data, and a musician who asked the browser
 * to save data did not ask for that.
 */
export function shouldWarmTabs(connection: { saveData?: boolean } | undefined): boolean {
  return connection?.saveData !== true;
}
