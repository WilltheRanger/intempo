/**
 * Handing a gesture's momentum to the spring that finishes it.
 *
 * **The seam this closes.** Both sheets in this app already measured how fast
 * the finger was moving at release, used it to pick a destination, and then
 * threw the number away: the spring that carried the sheet the rest of the way
 * always started from rest. A hard flick and a slow deliberate tug produced
 * byte-identical motion, so the moment the finger lifted there was a visible
 * discontinuity — the sheet stopped being thrown and started being played back.
 *
 * Handing the release velocity to the spring removes that seam. It is a small
 * change and it is the one that most separates a sheet that feels thrown from
 * one that feels animated.
 *
 * A rule in a module with tests, per `CLAUDE.md` §3, and here the reason is
 * sharper than usual: the whole thing is a **unit conversion**, and a unit
 * conversion that is silently wrong by 1000× does not crash, does not fail a
 * typecheck, and does not look wrong in a screenshot. It looks like a spring
 * that is slightly too lively, which is exactly the kind of thing that gets
 * "fixed" by nudging the damping and never measured again.
 */

/**
 * Milliseconds in a second — named because it is the whole of the bug this
 * module exists to prevent, and an unexplained `* 1000` is how it comes back.
 */
const MS_PER_SECOND = 1000;

/**
 * A gesture velocity in points per millisecond, as the spring wants it.
 *
 * **The two halves of this app measure in different units and neither says
 * so.** `PanResponder`'s `gestureState.vy` and `sheetDrag.velocityFrom` both
 * report points per *millisecond*; React Native's `Animated.spring` takes
 * `velocity` in units per *second*, the same units its `stiffness`, `damping`
 * and `mass` are expressed in. Handing `vy` straight across is not a small
 * error — it is a spring given a thousandth of the momentum it should have,
 * which is indistinguishable from the bug of passing no velocity at all.
 *
 * Non-finite input returns 0 rather than propagating a `NaN` into the
 * animation driver, where it becomes a sheet stuck off-screen: `velocityFrom`
 * divides by a time delta, and a single pair of samples sharing a timestamp is
 * not a rare event on a device under load.
 */
export function springVelocityFrom(pointsPerMs: number): number {
  if (!Number.isFinite(pointsPerMs)) {
    return 0;
  }
  return pointsPerMs * MS_PER_SECOND;
}

/**
 * The velocity to start a settle with, given where the sheet is going.
 *
 * Passed through when the finger was already moving towards the target, which
 * is the ordinary flick. **Dropped to zero when it points away**, and that
 * case is worth naming because it is not obviously wrong to keep it: a spring
 * handed velocity pointing away from its target is physically honest — it
 * carries on a little further, turns round and comes back.
 *
 * On a two-position sheet that honesty reads as a fault. The gesture that
 * produces it is a tug that did *not* commit, so the sheet is returning to
 * where it started; continuing away first makes a refused drag look like a
 * bounce, and the musician cannot tell "I did not move it far enough" from
 * "it did something I did not ask for". Real iOS sheets do the same thing —
 * a cancelled drag returns directly.
 *
 * `to` and `from` are offsets in points, in whatever direction the caller's
 * axis runs; only their difference is used, so a caller whose positive
 * direction is up needs no special case.
 */
export function settleVelocity(
  pointsPerMs: number,
  { from, to }: { from: number; to: number },
): number {
  const velocity = springVelocityFrom(pointsPerMs);
  const towards = to - from;
  // Already there: no direction to be right or wrong about, and dividing the
  // question into signs would make `towards === 0` arbitrary.
  if (towards === 0) {
    return 0;
  }
  return Math.sign(velocity) === Math.sign(towards) ? velocity : 0;
}
