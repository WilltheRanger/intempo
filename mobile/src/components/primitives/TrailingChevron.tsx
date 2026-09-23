import { View } from 'react-native';

import { ChevronRight } from '../icons';
import { colors, ICON_STROKE_WIDTH } from '../../design';

/**
 * The chevron at the end of a row, on the same right edge as everything else.
 *
 * lucide's chevron draws its stroke between x = 9 and 15 of a 24-unit box, so
 * a bare icon stops a quarter of its width short of its own edge — about 6pt
 * at the sizes rows use. Beside a value ("Pro") or a switch, which run to the
 * margin, the chevrons sat visibly inset: two right edges down one screen.
 * Reported from a phone, on Profile, on 2026-09-23.
 *
 * Pulled out by the empty part of the box, less half the stroke, so the ink
 * lands on the margin. The icon's box still sits inside the row, so the row's
 * touch target is unchanged.
 */
export function chevronOutset(size: number, strokeWidth: number): number {
  return (size * 9) / 24 - strokeWidth / 2;
}

/**
 * **One size, set by the label** (2026-09-23). Rows drew it at 17 on some
 * screens and 20 on others, and at 17 its ink was 8pt tall and hairline-thin
 * beside a 15pt label — the rows the owner circled on Piece detail. iOS draws
 * a disclosure chevron about as tall as its label's capitals; lucide's spans
 * half its box, so a 22 box is an 11pt chevron beside 15pt Inter's 10.9pt caps,
 * at the stroke every other icon uses.
 */
const SIZE = 22;

/**
 * The row's text line. The chevron's 22pt box is taller than it, and left in
 * the layout it made every row with a chevron 2pt taller than the row beside
 * it without one — Profile's "Email" under "Analyses". A negative margin of
 * the difference keeps the glyph where it is and out of the row's height.
 */
const ROW_LINE = 20;

export function TrailingChevron() {
  return (
    <View
      style={{
        marginRight: -chevronOutset(SIZE, ICON_STROKE_WIDTH),
        marginVertical: (ROW_LINE - SIZE) / 2,
      }}
    >
      <ChevronRight size={SIZE} strokeWidth={ICON_STROKE_WIDTH} color={colors.textTertiary} />
    </View>
  );
}
