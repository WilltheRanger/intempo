/**
 * How wide a bar is in one of the app's bar charts, given the slot it stands in.
 *
 * **One rule for both charts** (2026-09-23, "bars are not big enough or too
 * big"). Insights' passage chart drew 27pt blocks, 82% of their slot, and the
 * verdict's bar-by-bar drew 9pt needles — the same mark, a deviation from the
 * beat standing on a centre rule, at three times the width on one screen as on
 * the next. Now a bar takes a little over half its slot, so the gaps read as
 * part of the chart rather than as cracks between blocks, and never more than
 * 16pt, the width at which a bar stops reading as a line and starts reading as
 * a tile.
 *
 * A sixty-bar piece still gets a bar per measure: the floor is a stroke, and
 * the verdict's chart takes the finger across its whole strip rather than per
 * bar, so a narrow bar costs nothing to hit.
 */
const SHARE = 0.55;
const WIDEST = 16;
const NARROWEST = 1.5;

export function chartBarWidth(slot: number): number {
  if (!(slot > 0)) {
    return 0;
  }
  return Math.max(NARROWEST, Math.min(WIDEST, slot * SHARE));
}
