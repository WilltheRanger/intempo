/**
 * Corner radii. Five values, no others.
 *
 * `pill` is reserved for elements where the shape carries meaning (a progress
 * track, a status chip). It is not a default for buttons — the brief calls out
 * excessive pill-shaped UI specifically.
 */
export const radii = {
  /** Thumbnails and other small surfaces. */
  sm: 8,
  /** Cards, buttons, inputs. The workhorse. */
  md: 12,
  /** Major surfaces: modals, the featured card. */
  lg: 16,
  /**
   * The top corners of a bottom sheet — the redesign's (2026-09-23), which
   * draws every sheet at 22. Larger than `lg` because a sheet is the one
   * surface that rises over the whole screen, and its curve is what says so.
   */
  sheet: 22,
  /** Fully rounded. Progress tracks and similar. */
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radii;
