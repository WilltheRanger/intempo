/**
 * Spacing scale. Every margin, padding, and gap in the app resolves to one of
 * these. If a layout seems to need a value that isn't here, the layout is
 * wrong — don't add a step without a design decision behind it.
 *
 * **`tools/check-spacing.py` holds this** (2026-11-12). The UI review counted
 * 89 margins, paddings and gaps off the scale — 10, 6, 14, 18 and 26 most
 * often — each a reasonable guess where it was typed and together no rhythm.
 * A value that is not a step is not spacing: a hit area's outset, an optical
 * nudge, a centring offset. Those are named for what they are and computed
 * from what they depend on (`MIN_TOUCH_TARGET`, a line height), which is what
 * the check lets through.
 */
export const spacing = {
  /**
   * Between a line and its own second line: a row's name and its detail, a
   * stepper's number and its unit, two tiles in a well. Leading rather than
   * layout, and the one step under `xs`, added with the check because the
   * survey found it eleven times and always doing this.
   */
  '2xs': 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

export type SpacingToken = keyof typeof spacing;
