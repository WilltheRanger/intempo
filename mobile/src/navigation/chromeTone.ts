/**
 * Which material the floating chrome wears, given what is behind it *now*.
 *
 * **The glass has no ground of its own.** `GlassSurface` is translucent and
 * whatever is beneath it decides how it reads — fine on screens that share the
 * appearance's page colour, and wrong on one that does not. Today is a
 * photograph: an opaque ink ground with a manuscript on it, in *both*
 * appearances, because that is a property of the screen rather than of the
 * appearance (the same argument `colors.darkBg` is named for).
 *
 * **The first version of this keyed on the route name, and that was wrong.**
 * A screen is not one ground. Today's hero is exactly one viewport tall and
 * ordinary page content follows it, so scrolling slides the capsule off the
 * photograph and onto ivory while the route is unchanged. Measured on the
 * built bundle, scrolled to the bottom: the dark capsule composited to
 * `#88857D` on the page and its inactive labels fell to **1.46:1** — furniture
 * you navigate by, gone. A route is a screen's name; the tone is about a
 * rectangle, and the two only agree while nothing moves.
 *
 * So a screen declares how tall its dark ground is and the chrome asks where
 * it is relative to that. A screen with none declares nothing and pays
 * nothing.
 *
 * **A rule, not a ternary in a component** — `CLAUDE.md` §3. There is no React
 * Native testing library here (`DECISIONS.md`, 2026-08-24), so the arithmetic
 * below written inside `BottomTabBar.tsx` would be arithmetic nothing checks,
 * and it is the kind with an off-by-a-viewport in it.
 */

/** The material a control layer is drawn in. */
export type SurfaceTone = 'auto' | 'onDark';

export interface ChromeToneInput {
  /** How far the screen under the chrome has scrolled, in points. */
  scrollY: number;
  /**
   * How much of the top of that screen's *content* is a dark ground.
   *
   * Content points, not screen points — it does not move when the screen
   * scrolls. Zero, or anything less, for a screen that has none, which is
   * every screen but Today.
   */
  darkGroundHeight: number;
  /**
   * The chrome's own midline, in points from the top of the viewport.
   *
   * **The midline rather than either edge, because the capsule is 76 points
   * tall and the ground ends somewhere.** Its bottom edge crosses at one
   * scroll offset and its top edge 76 points later, and between the two it is
   * genuinely half on a photograph and half on a page — there is no reading of
   * "over the dark ground" that is true throughout. The midline is the one
   * threshold that is wrong for the least of that span.
   */
  chromeMidline: number;
}

/**
 * The tone for chrome floating over a screen at its current scroll offset.
 *
 * Defensive about its inputs because they arrive from layout: a viewport that
 * has not measured yet reports 0, and `onScroll` reports a negative offset for
 * the whole of a rubber-band overscroll at the top — which is *more* over the
 * dark ground, not less, so it must not be read as having scrolled past it.
 */
export function chromeToneFor({
  scrollY,
  darkGroundHeight,
  chromeMidline,
}: ChromeToneInput): SurfaceTone {
  if (!(darkGroundHeight > 0)) {
    return 'auto';
  }
  return Math.max(scrollY, 0) + chromeMidline < darkGroundHeight ? 'onDark' : 'auto';
}
