import { View } from 'react-native';

import { ChevronRight } from '../icons';
import { colors } from '../../design';

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

export function TrailingChevron({
  size = 17,
  strokeWidth = 1.6,
  color = colors.textTertiary,
}: {
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  return (
    <View style={{ marginRight: -chevronOutset(size, strokeWidth) }}>
      <ChevronRight size={size} strokeWidth={strokeWidth} color={color} />
    </View>
  );
}
