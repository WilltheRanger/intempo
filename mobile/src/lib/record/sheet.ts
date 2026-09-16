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
  /** Total vertical movement, positive downwards, in points. */
  dy: number;
  /** Instantaneous vertical velocity at release, points per millisecond. */
  vy: number;
}

/**
 * The distance the sheet moves between its two positions.
 *
 * Never zero or negative: a sheet with no travel would make every drag a
 * commit, since `dy` would always clear the threshold.
 */
export function travelFor(sheetHeight: number, visibleWhenLowered: number): number {
  return Math.max(1, sheetHeight - visibleWhenLowered);
}

/**
 * Where a drag from `from` ends up.
 *
 * Direction is decided by velocity when the release is fast, and by distance
 * otherwise. A drag that goes the wrong way — pulling down on an already
 * lowered sheet — never commits, because there is nowhere further to go.
 *
 * `travel` is required, and the first version of this function did not take it:
 * it tested `forwards > 0`, so any movement at all committed and
 * `COMMIT_FRACTION` was declared and never read. A two-point twitch would have
 * dropped the sheet. The test found it on the first run, which is the argument
 * for the rule living out here rather than inside the component.
 */
export function settleTo(
  from: SheetPosition,
  { dy, vy }: DragEnd,
  travel: number,
): SheetPosition {
  if (Math.abs(vy) >= FLICK_VELOCITY) {
    return vy > 0 ? 'lowered' : 'raised';
  }

  const towardsLowered = from === 'raised';
  const forwards = towardsLowered ? dy : -dy;
  const enough = travelFor(travel, 0) * COMMIT_FRACTION;

  if (forwards < enough) return from;
  return towardsLowered ? 'lowered' : 'raised';
}

/**
 * The offset to draw at mid-drag, clamped to the travel.
 *
 * Clamped rather than rubber-banded: a rubber band past the end says the sheet
 * could go further, which is a second thing the affordance would be promising
 * and not doing.
 */
export function offsetDuring(
  from: SheetPosition,
  dy: number,
  travel: number,
): number {
  const base = from === 'lowered' ? travel : 0;
  return Math.min(travel, Math.max(0, base + dy));
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
