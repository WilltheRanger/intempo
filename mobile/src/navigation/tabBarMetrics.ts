import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ICON_SIZE, MIN_TOUCH_TARGET, spacing, typography } from '../design';

/**
 * Height of one tab's icon-and-label stack.
 *
 * Derived from the same tokens `BottomTabBar` lays out with, so the two can't
 * drift apart.
 */
export const TAB_BAR_ROW_HEIGHT = Math.max(
  MIN_TOUCH_TARGET,
  ICON_SIZE.lg + spacing.xs + typography.sectionLabel.lineHeight,
);

/** Padding above the icons. */
export const TAB_BAR_PADDING_TOP = spacing.md;

/**
 * Minimum padding below the labels, when there's no home indicator to clear.
 *
 * Only ever a floor — on a device that reports an inset, the inset wins. It is
 * one step above the padding on top of the icons because the labels sit at the
 * very edge of the frame, and matching the two made the row read as bottom-
 * heavy on hardware with no inset at all.
 */
export const TAB_BAR_MIN_PADDING_BOTTOM = spacing.lg;

/**
 * Total height of the tab bar, including the home-indicator inset.
 *
 * `BottomTabBarHeightContext` is not usable for this: with a custom `tabBar`
 * React Navigation publishes its own default (49pt) rather than measuring what
 * we actually render, which is 71pt before the safe-area inset. Trusting it
 * left content sitting behind the bar.
 */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return (
    TAB_BAR_PADDING_TOP +
    TAB_BAR_ROW_HEIGHT +
    Math.max(insets.bottom, TAB_BAR_MIN_PADDING_BOTTOM)
  );
}
