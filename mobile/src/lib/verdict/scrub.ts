/**
 * Moving within a recording by touching the track it is drawn on.
 *
 * **The track was drawn and could not be moved.** It is a rounded rail with a
 * filled portion and a time at either end — every part a scrubber has — and
 * the only control under it was play and pause. §3 is explicit that a drawn
 * affordance must do the thing it depicts, and this one depicted a position you
 * could choose. A musician checking bar seven against the row that names it had
 * to listen to the six before it, every time.
 *
 * The arithmetic is here rather than in the component for the usual reason:
 * there is no React Native testing library in this project (`DECISIONS.md`,
 * 2026-08-24), and "does a touch at the right edge seek past the end" is a
 * question worth an answer that does not depend on somebody dragging.
 */

/**
 * Where along the track a touch landed, as 0 to 1, or null for a track that
 * cannot answer.
 *
 * Clamped at both ends, which is not defensive tidiness: a drag that began on
 * the track and continued past it reports a negative x, and on the web build a
 * pointer that leaves the element keeps reporting. Seeking to a negative time
 * throws on some players and silently restarts on others.
 *
 * **Null for an unmeasured track, not zero.** The first draft returned zero —
 * "the layout has not run, so there is no position" — and zero is not the
 * absence of a position, it is the *start of the recording*. A touch arriving
 * before `onLayout` would have rewound a take that was playing, which is the
 * same mistake `scrubSeconds` refuses one step later for an unknown duration.
 * A test written to describe the guard found that it did not hold.
 */
export function scrubFraction(x: number, width: number): number | null {
  if (!(width > 0) || !Number.isFinite(x)) {
    return null;
  }
  return Math.min(1, Math.max(0, x / width));
}

/**
 * The second to seek to, or null when there is nothing to seek within.
 *
 * Null rather than 0 for an unknown duration. A recording still loading has
 * `duration` 0, and seeking it to zero is a real instruction — it would rewind
 * a take that had already started playing, on a touch the musician meant as
 * "go to the middle".
 */
export function scrubSeconds(
  fraction: number | null,
  duration: number,
): number | null {
  if (fraction === null || !(duration > 0) || !Number.isFinite(duration)) {
    return null;
  }
  return Math.min(duration, Math.max(0, fraction * duration));
}

/** How far the keyboard and screen-reader actions move, in seconds. */
export const SCRUB_STEP_S = 5;

/**
 * A nudge from the increment/decrement actions.
 *
 * The route for anyone not dragging a finger across a 6pt rail, which is the
 * reason the gesture cannot be the only way in. Clamped to the recording, so
 * holding decrement at the start does not walk the position negative.
 */
export function scrubStep(
  current: number,
  duration: number,
  direction: 1 | -1,
): number | null {
  if (!(duration > 0) || !Number.isFinite(duration)) {
    return null;
  }
  const next = current + direction * SCRUB_STEP_S;
  return Math.min(duration, Math.max(0, next));
}
