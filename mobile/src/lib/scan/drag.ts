/**
 * Where a dragged page lands, and whether it lands at all.
 *
 * Pulled out of `DraggablePageList` because the component is untestable —
 * this project has no React Native testing library — and because the rule that
 * was missing is not arithmetic at all. It is the difference between a gesture
 * that **ended** and one that was **taken away**.
 */

/**
 * How a drag finished.
 *
 * `released` is a finger lifting off. `cancelled` is `onPanResponderTerminate`:
 * the responder was taken from the row mid-drag — the enclosing `ScrollView`
 * claimed the touch, the app went to the background, a call arrived. The row
 * used to run the identical body for both, so a musician who pressed the grip
 * on page 1 of a six-page scan, dragged down two rows, and then got a call
 * came back to find page 1 sitting at position 3: a reorder they began and
 * never completed. Because the upload sends `pages[0]`, that also silently
 * changed which page the app transcribed.
 */
export type DragOutcome = 'released' | 'cancelled';

/**
 * How many slots up or down the row currently sits, given how far it has moved.
 *
 * Rounded rather than floored, so a row is picked up by the slot it is *most*
 * in — half a row of travel is a move, not a hover. Clamped to the list: there
 * is no position above the first page or below the last, and without the clamp
 * a long drag past either end reports a target the list does not have.
 */
export function slotOffsetFor(
  dy: number,
  pitch: number,
  index: number,
  total: number,
): number {
  // A pitch of zero would divide to Infinity. It is a measured row height, so
  // it is only ever zero before the first row has reported its layout.
  if (!Number.isFinite(pitch) || pitch <= 0) {
    return 0;
  }
  const raw = Math.round(dy / pitch);
  const clamped = Math.max(-index, Math.min(total - 1 - index, raw));
  // `Math.max(-0, …)` is -0 whenever the top row is dragged upwards against
  // the clamp. It compares equal to 0 so nothing here misbehaves, but "no
  // move" is a value callers may reasonably compare with `Object.is`, and a
  // negative zero escaping a public function is a trap left lying about.
  return clamped === 0 ? 0 : clamped;
}

/**
 * The index a finished drag should move the page to, or null to leave it alone.
 *
 * Null for a cancelled gesture and null for a drag that ended where it started
 * — the second so a tap on the grip, or a drag and a change of mind, does not
 * write a no-op reorder through the session.
 */
export function reorderTarget(
  outcome: DragOutcome,
  index: number,
  slotOffset: number,
): number | null {
  if (outcome === 'cancelled' || slotOffset === 0) {
    return null;
  }
  return index + slotOffset;
}
