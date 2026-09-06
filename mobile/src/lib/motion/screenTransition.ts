/**
 * How a pushed screen arrives and leaves, on the web build.
 *
 * **Only the web build.** On iOS `@react-navigation/native-stack` hands the
 * push to `UINavigationController`, so the slide, the parallax on the screen
 * behind and the interactive swipe-back are Apple's own and are already right.
 * Measured on the built bundle on 2026-09-06: pushing a screen in a browser
 * produced 3 distinct frames out of 35 sampled, and going back produced 1 —
 * a hard cut both ways. This is the code that fixes the browser and changes
 * nothing on a phone.
 *
 * **What could not be matched, and why.** iOS slides the outgoing screen left
 * at a third of the speed while the new one comes in over it. That needs the
 * screen underneath to be visible, and `react-native-screens` sets
 * `display: none` on it the moment the push commits — measured, both screens
 * stay mounted as absolutely-positioned siblings and the lower one is hidden.
 * Fighting that would mean overriding a library's internal styling from
 * outside, which breaks on any upgrade. So depth is carried by a scrim that
 * fades under the incoming screen instead: the same reading — something has
 * come forward and covered what you were looking at — without a claim on
 * anything the navigator owns.
 *
 * A rule in a module with tests, because there is no React Native testing
 * library here and a threshold inside a `.tsx` is a threshold nothing checks
 * (`CLAUDE.md` §3).
 */

/**
 * How far along the pop gesture must be, as a fraction of screen width, for
 * letting go to complete it.
 *
 * A third rather than a half: an interactive back gesture that needs the
 * screen dragged past its own centre is one people stop trusting, because the
 * common case — a quick pull from the edge — lands short and snaps back.
 */
export const POP_TRAVEL_FRACTION = 0.33;

/**
 * Rightward speed, in points per millisecond, that completes the pop however
 * far the screen has actually travelled.
 *
 * The same reasoning as the sheet's `DISMISS_VELOCITY`, and the same number:
 * a flick is how someone who has already decided goes back, and judging it on
 * distance alone refuses it.
 */
export const POP_VELOCITY = 0.5;

/**
 * How wide the strip along the left edge is that starts a back gesture, in
 * points.
 *
 * iOS uses about 20. Wider would be more forgiving and would also swallow the
 * first inch of every horizontal swipe inside a screen — and this app has a
 * score that scrolls sideways.
 */
export const EDGE_WIDTH = 20;

/** Travel before an edge touch is a drag rather than a tap that moved. */
export const POP_ACTIVATION_DISTANCE = 6;

/**
 * Peak opacity of the scrim under a pushed screen.
 *
 * Standing in for the dimmed screen iOS slides away underneath. Low: it is
 * depth, not a modal — at a modal's weight every push would read as a
 * question being asked.
 */
export const SCRIM_OPACITY = 0.18;

export interface PopRelease {
  /** Rightward travel when the finger lifted, in points. */
  dx: number;
  /** Rightward speed at that moment, in points per millisecond. */
  vx: number;
  /** The screen's width. */
  width: number;
}

/**
 * Distance **or** speed completes the pop.
 *
 * A leftward drag never pops, however fast — `vx` is signed, and a negative
 * velocity past the threshold would otherwise go back on the gesture that
 * means "stay".
 */
export function shouldPop({ dx, vx, width }: PopRelease): boolean {
  if (dx <= 0) {
    return false;
  }
  if (vx >= POP_VELOCITY) {
    return true;
  }
  // Width is 0 before layout. Fall back to velocity rather than dividing by it
  // and popping on the first pixel of the first gesture after mount.
  return width > 0 && dx >= width * POP_TRAVEL_FRACTION;
}

/**
 * The offset actually applied for a given finger travel.
 *
 * Rightward is followed exactly. Leftward is refused outright rather than
 * rubber-banded: there is nothing to the left of a screen at the top of the
 * stack, and a screen that gives when pulled towards its own edge reads as
 * loose rather than as bounded.
 */
export function popOffset(dx: number): number {
  return dx > 0 ? dx : 0;
}

/**
 * Whether a touch that began at the edge should become a back gesture.
 *
 * Rightward *and* far enough. The dominance test is what stops a vertical
 * scroll that started near the edge from dragging the screen sideways.
 */
export function isPopGesture(dx: number, dy: number): boolean {
  return dx > POP_ACTIVATION_DISTANCE && Math.abs(dx) > Math.abs(dy);
}

/** Whether a touch started inside the strip that owns the back gesture. */
export function startsAtEdge(pageX: number): boolean {
  return pageX <= EDGE_WIDTH;
}

/**
 * Scrim opacity for a screen that is `progress` of the way in (1 = arrived).
 *
 * Fades with the screen rather than snapping on, so a half-completed swipe
 * back is half-lit — the state of the gesture is legible at every point in it,
 * which is the whole reason an interactive transition is worth more than an
 * animated one.
 */
export function scrimOpacity(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * SCRIM_OPACITY;
}
