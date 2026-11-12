/**
 * Motion with no end, written for the browser to run.
 *
 * **The web has no native driver, so an `Animated.loop` there is JavaScript on
 * every frame for as long as it runs.** The Library's photograph drifted that
 * way. A settled Library, with nothing loading and nothing touched, kept the
 * main thread busy for 806 ms of every second with the CPU slowed four times,
 * and for none of it with the drift stopped (2026-10-24). Every tap and every
 * scroll on that screen waited behind it. A CSS animation of `transform` or
 * `opacity` is run by the compositor, off the main thread, and costs that
 * thread nothing while it runs.
 *
 * `FadeIn` hands its entrances to CSS for the same reason; this is the same
 * move for motion that never finishes. The curves are fitted to the `Easing`
 * functions the native loops use, so both platforms draw the same motion.
 */

/**
 * `Easing.inOut(Easing.sin)`, which is `(1 - cos πt) / 2`, as a CSS curve.
 *
 * Fitted rather than the usual `0.37 … 0.63`: it stays within 0.04% of the
 * function's travel, which is a hundredth of a point on the band's drift.
 */
export const SINE_IN_OUT_CSS = 'cubic-bezier(0.365, 0, 0.635, 1)';

/**
 * `Easing.inOut(Easing.ease)`, `Animated.timing`'s default, as a CSS curve.
 *
 * Fitted, within 0.6% of the function's travel. CSS's own `ease-in-out`
 * strays 2.9% from it.
 */
export const EASE_IN_OUT_CSS = 'cubic-bezier(0.34, 0, 0.66, 1)';

/** A motion that goes from one end to the other and back, forever. */
export interface Swing {
  /** One end, as CSS declarations in React Native for Web's spelling. */
  from: Record<string, string | number>;
  /** The other end. */
  to: Record<string, string | number>;
  /** One way, in milliseconds. The way back takes as long. */
  ms: number;
  /** The curve each way. */
  easing: string;
  /**
   * Begin half way along the first leg, at the middle of the travel and moving
   * towards `to`, as a loop whose value starts between its ends does.
   */
  fromMiddle?: boolean;
}

/**
 * A swing as a style, for `StyleSheet.create` on the web.
 *
 * **`StyleSheet.create` only.** React Native for Web turns `animationKeyframes`
 * into a `@keyframes` rule when it compiles a sheet, and drops it from an
 * inline style. `alternate` runs one leg there and one back, which is the
 * `Animated.sequence` of two timings the native loops run.
 */
export function swingStyle({ from, to, ms, easing, fromMiddle = false }: Swing): Record<string, unknown> {
  return {
    animationKeyframes: [{ '0%': from, '100%': to }],
    animationDuration: `${ms}ms`,
    animationTimingFunction: easing,
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
    // A negative delay starts the animation part of the way in. Half a leg in,
    // a symmetric curve is exactly half way along.
    animationDelay: `${fromMiddle ? -ms / 2 : 0}ms`,
  };
}

/** Holds a swing where it is, for a screen that is not the one in front. */
export const SWING_PAUSED: Record<string, unknown> = { animationPlayState: 'paused' };
