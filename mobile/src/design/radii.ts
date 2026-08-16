/**
 * Corner radii. Four values, no others.
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
  /** Major surfaces: sheets, modals, the featured card. */
  lg: 16,
  /** Fully rounded. Progress tracks and similar. */
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radii;
