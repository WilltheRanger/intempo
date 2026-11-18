import { DISMISS_TRAVEL_FRACTION, UPWARD_RESISTANCE, shouldDismiss } from './sheetDrag';

/**
 * A long sheet's two heights: half the screen, and all of it.
 *
 * **Why it opens at half** (the owner, 2026-11-13: "long ones open at half
 * height"). The sheets that hold a list to choose from — a key signature, a
 * clef, a bar to start at — rose straight to the full height of the screen,
 * which covers the screen they belong to for a choice that is usually near
 * the top of the list. UIKit opens such a sheet at its medium height, and the
 * grab bar takes it to the large one; dragging it down from there brings it
 * back to medium, and from medium, away.
 *
 * Velocities in points per millisecond, as in `sheetDrag.ts`. The detent
 * thresholds are Vaul's, which copies UIKit: a flick faster than 0.4 moves one
 * height, and a slow drag that has not covered 40% of the way back settles
 * where it started.
 */

/** Medium: half the window. */
export const MEDIUM_SHARE = 0.5;

/** A flick at least this fast moves the sheet one height. */
export const DETENT_VELOCITY = 0.4;

/** A slow drag that covers this share of the way between the heights moves to the other. */
export const DETENT_TRAVEL_FRACTION = 0.4;

/**
 * How far below its full height the sheet rests at medium, in points.
 *
 * Zero where half the window would show the whole sheet anyway — a small
 * screen, a short sheet — and then the sheet has one height.
 */
export function mediumOffset(sheetHeight: number, windowHeight: number): number {
  return Math.max(0, Math.round(sheetHeight - windowHeight * MEDIUM_SHARE));
}

export type Detent = 'medium' | 'large';

/**
 * Where the finger has put the sheet, on top of where it rests.
 *
 * From medium it travels freely up to the large height and resists past it;
 * from large it resists going up at all, as a sheet with nowhere higher to go
 * does (`sheetDrag.dragOffset`). Down is always free.
 */
export function detentDragOffset(dy: number, at: Detent, offset: number): number {
  if (dy >= 0) {
    return dy;
  }
  const free = at === 'medium' ? offset : 0;
  if (-dy <= free) {
    return dy;
  }
  return -free + (dy + free) * UPWARD_RESISTANCE;
}

export interface DetentRelease {
  at: Detent;
  /** How far the finger moved, positive down. */
  dy: number;
  /** How fast it was moving when it lifted, positive down. */
  vy: number;
  /** `mediumOffset`. */
  offset: number;
  /** The sheet's full height. */
  height: number;
}

/** Where a long sheet goes when the finger lifts. */
export function settleDetent({ at, dy, vy, offset, height }: DetentRelease): Detent | 'dismiss' {
  const between = offset * DETENT_TRAVEL_FRACTION;
  if (at === 'medium') {
    if (dy < 0) {
      return -dy >= between || vy <= -DETENT_VELOCITY ? 'large' : 'medium';
    }
    // What shows at medium is the sheet less its offset, and that is what a
    // drag to dismiss is measured against.
    return shouldDismiss({ dy, vy, height: height - offset }) ? 'dismiss' : 'medium';
  }
  if (dy <= 0) {
    return 'large';
  }
  // From the top, a drag past medium and most of the way down again closes it;
  // otherwise it comes to rest at medium, or back at large.
  if (dy >= offset + (height - offset) * DISMISS_TRAVEL_FRACTION) {
    return 'dismiss';
  }
  return dy >= between || vy >= DETENT_VELOCITY ? 'medium' : 'large';
}
