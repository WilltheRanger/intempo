/**
 * Where a dragged sheet settles when the finger leaves it.
 *
 * The rule, not the component, for the reason `CLAUDE.md` §3 gives: there is no
 * React Native testing library here, so anything decided inside a `.tsx` is
 * decided by nothing that can check it. A sheet that only opens when you drag
 * it exactly far enough is the kind of thing that is wrong in one direction
 * and nobody notices for a month.
 */

/** Raised covers the controls; lowered slides them off to show the music. */
export type SheetPosition = 'raised' | 'lowered';

/**
 * A flick commits regardless of distance, in points per millisecond.
 *
 * Deliberately low. The gesture is one-handed, often with a bow in the other,
 * and the cost of committing a flick the musician half-meant is one more flick
 * back — where the cost of *not* committing is a sheet that feels stuck.
 */
export const FLICK_VELOCITY = 0.35;

/**
 * How far through the travel a slow drag has to get to commit: a third.
 *
 * Not a half. A half means the common case — a short deliberate tug — snaps
 * back, which reads as the sheet refusing rather than as the drag being too
 * small.
 */
export const COMMIT_FRACTION = 1 / 3;

export interface DragEnd {
  /** The offset the sheet sat at when the finger claimed it, in points. */
  grabbedAt: number;
  /** The offset it sat at when the finger lifted, in points. */
  releasedAt: number;
  /** Vertical velocity at release, points per millisecond, positive downwards. */
  vy: number;
}

/**
 * The distance the sheet moves between its two positions.
 *
 * Never zero or negative: a sheet with no travel would make every drag a
 * commit, since the movement would always clear the threshold.
 */
export function travelFor(sheetHeight: number, visibleWhenLowered: number): number {
  return Math.max(1, sheetHeight - visibleWhenLowered);
}

/**
 * The anchor an offset is closest to.
 *
 * Needed because a grab no longer implies a position. Before this the sheet
 * was only ever grabbed at rest, so "where it came from" was one of two
 * values; a sheet you can catch mid-flight can be grabbed anywhere, and a
 * drag too small to commit has to return to *an* anchor rather than to a
 * `SheetPosition` nobody recorded.
 */
export function anchorNearest(offset: number, travel: number): SheetPosition {
  return offset >= travel / 2 ? 'lowered' : 'raised';
}

/**
 * Where a drag ends up.
 *
 * Decided from **the distance the finger actually moved the sheet**, not from
 * the position it started at — which is what lets the sheet be caught while it
 * is still settling. The previous version took a `SheetPosition` and measured
 * against it, so a sheet grabbed in flight was measured from an anchor it was
 * no longer anywhere near: a 10pt nudge on a sheet caught at four fifths of
 * its travel read as a four-fifths drag and committed.
 *
 * Velocity still overrules distance, and still decides by **sign** rather than
 * by where the finger ended up, so a flick commits however short it was. A
 * drag that goes the wrong way — pulling down on an already lowered sheet —
 * still cannot commit, because `offsetFromGrab` clamps it and the movement
 * comes out as zero.
 *
 * `travel` is required, and an early version of this function did not take it:
 * it tested `forwards > 0`, so any movement at all committed and
 * `COMMIT_FRACTION` was declared and never read. A two-point twitch would have
 * dropped the sheet. The test found it on the first run, which is the argument
 * for the rule living out here rather than inside the component.
 */
export function settleFrom(
  { grabbedAt, releasedAt, vy }: DragEnd,
  travel: number,
): SheetPosition {
  if (Math.abs(vy) >= FLICK_VELOCITY) {
    return vy > 0 ? 'lowered' : 'raised';
  }

  const moved = releasedAt - grabbedAt;
  const enough = travelFor(travel, 0) * COMMIT_FRACTION;

  if (moved >= enough) return 'lowered';
  if (moved <= -enough) return 'raised';
  return anchorNearest(grabbedAt, travel);
}

/**
 * The offset to draw at mid-drag, clamped to the travel.
 *
 * Measured from **the offset the sheet was at when the finger landed on it**,
 * which on a sheet that can be caught mid-flight is a live number read off the
 * animation rather than one of two anchors. Starting from the anchor instead
 * is the jump this change exists to remove: the settle sets the target
 * position first and the spring catches up afterwards, so a sheet grabbed
 * while it was still moving snapped to wherever the target implied before it
 * began following the finger.
 *
 * Clamped rather than rubber-banded: a rubber band past the end says the sheet
 * could go further, which is a second thing the affordance would be promising
 * and not doing.
 */
export function offsetFromGrab(
  grabbedAt: number,
  dy: number,
  travel: number,
): number {
  return Math.min(travel, Math.max(0, grabbedAt + dy));
}

/** How far a drag has to run before it is a drag and not a tap. */
export const DRAG_SLOP = 4;

/**
 * Does this movement claim the gesture?
 *
 * Vertical intent only. Without the comparison a sideways swipe over the sheet
 * — which on iOS is the back gesture — would be captured and the screen would
 * become one you cannot leave by swiping.
 */
export function isVerticalDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > DRAG_SLOP && Math.abs(dy) > Math.abs(dx);
}
