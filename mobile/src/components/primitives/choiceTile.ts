import { StyleSheet } from 'react-native';

import { BORDER_WIDTH, colors, fontFamily } from '../../design';

/**
 * A chosen option among several on the page: an instrument, a role, a
 * suggested tempo, a note value, a mark switched on, an answer to a proposal.
 *
 * **Outlined in ink, never filled with it** (the UI review, 2026-11-12). Each
 * of these was filled with `actionBg`, the ink of the screen's one action, so
 * "I teach" sat over Next, "Marked · 96" over Done and the half-note chip over
 * Save as two equal focal points, against §3 law 4. A chosen tile keeps the
 * white control surface every option has, takes the ink as its edge, and its
 * label goes up a weight. The fill is the action's alone, and
 * `actionInk.test.ts` keeps it that way.
 *
 * The app's other two ways of showing a choice stay as they are, because each
 * is the platform's own: a row in a list or sheet carries a check
 * (`InstrumentSheet`, `StartFromSheet`), and a segmented control raises its
 * tile inside the track (`SegmentedControl`).
 */
const CHOSEN_BORDER_WIDTH = 1.5;

export const choiceTile = StyleSheet.create({
  /** Every option, chosen or not: a control on the page, white on ivory. */
  surface: {
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  /**
   * The chosen one. Half a point heavier than the hairline it replaces, which
   * moves a centred label by nothing and a left-aligned one by half a point.
   */
  chosen: {
    borderWidth: CHOSEN_BORDER_WIDTH,
    borderColor: colors.textPrimary,
  },
  /** Under the finger, before the choice lands. */
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  /** A sans label on the chosen tile. A serif title is already medium. */
  chosenLabel: {
    fontFamily: fontFamily.sansMedium,
  },
});
