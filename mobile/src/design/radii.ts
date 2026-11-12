/**
 * Corner radii. Five values, no others, and the rule they serve.
 *
 * **The shape rule** (written down 2026-11-12). This file used to say pills
 * were "not a default for buttons" while every button in the app was one, so
 * the comment and the screens disagreed and nothing said which one was right.
 * The screens were. The rule is:
 *
 *  - **An action is a capsule.** `PrimaryButton`, `SecondaryButton`, Listen,
 *    Tap tempo, and the round controls (`IconButton`, the record button, the
 *    pitch stepper) are fully rounded: `pill`, or a circle at half their
 *    height. The shape means "press this", and only an action wears it.
 *  - **Anything chosen or filled in is a rounded rectangle at `md`**: a choice
 *    tile (`choiceTile`), an input, a segmented track, a card. Never a
 *    capsule, so a chosen answer cannot be mistaken for a button.
 *  - **A surface that rises over the screen is rounder**: `lg` for a dialog
 *    or the featured card, `sheet` for a bottom sheet's top corners.
 *  - **`sm` is for small pictures**: a thumbnail, a page in a list.
 *  - **A shape inside another is concentric**: its radius is the outer one
 *    less the inset between them, as the segmented control's tile is `md`
 *    less its track's padding.
 *  - **A mark inside a drawing** (a bar on a chart, a progress fill, a tick)
 *    rounds to its own size and is not on this scale.
 *
 * The brief's warning about pill-shaped UI is kept by the second rule: the
 * capsule is for the few things that act, not for chips, tags, tiles or
 * values (Record's settings drew their values in pills until the same day).
 */
export const radii = {
  /** Thumbnails, pages, small pictures. */
  sm: 8,
  /** Choices, inputs, segmented tracks, cards. The workhorse. */
  md: 12,
  /** Major surfaces: modals, the featured card. */
  lg: 16,
  /**
   * The top corners of a bottom sheet — the redesign's (2026-09-23), which
   * draws every sheet at 22. Larger than `lg` because a sheet is the one
   * surface that rises over the whole screen, and its curve is what says so.
   */
  sheet: 22,
  /** Fully rounded: an action's capsule, a track, a dot. */
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radii;
