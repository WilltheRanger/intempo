import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { ICON_SIZE, MIN_TOUCH_TARGET, spacing, typography } from '../design';

/**
 * Height of one tab's icon-and-label stack.
 *
 * Derived from the same tokens `BottomTabBar` lays out with, so the two can't
 * drift apart.
 */
export const TAB_BAR_ROW_HEIGHT = Math.max(
  MIN_TOUCH_TARGET,
  ICON_SIZE.lg + spacing.xs + typography.tabLabel.lineHeight,
);

/**
 * Padding above the icons, and below the labels.
 *
 * `sm`, not `md`: with the smaller label the row is the 44pt target and no
 * more, and 12pt round it made a 68pt capsule — the bar reading as a panel
 * rather than furniture. 60pt is about the height iOS draws its own.
 */
export const TAB_BAR_PADDING_TOP = spacing.sm;

/** How far the floating capsule sits in from the left and right edges. */
export const TAB_BAR_FLOAT_INSET = spacing.md;

/**
 * The largest gap the capsule will ever leave beneath itself.
 *
 * A ceiling, not an addition. Devices report very different bottom insets — 34
 * on a Pro, 16–24 for Android gesture navigation, 0 in a browser — and the
 * capsule only has to clear the home indicator, which is a 5pt pill sitting
 * about 8pt up. Anything past this is empty page.
 */
export const TAB_BAR_FLOAT_BOTTOM_MAX = spacing.xl;

/**
 * The gap between the capsule's bottom edge and the bottom of the screen.
 *
 * **Clamped against the safe-area inset, never added to it.** Summing them
 * paid for the same clearance twice: `max(34, 16) + 12` put the capsule's
 * bottom edge **46pt** off the bottom of a Pro, roughly 33pt above anything it
 * needed to avoid. That is what "the bottom bar is not close to the bottom"
 * was.
 *
 *   home indicator (34pt inset) → min(max(34, 12), 20) = 20pt
 *   Android gesture nav (16–24) → 16–20pt
 *   no inset (the web build)    → 12pt
 *
 * The floor stops a device reporting nothing from putting the capsule on the
 * screen edge; the ceiling stops a generous inset pushing it back up.
 */
export function tabBarFloatBottom(insets: EdgeInsets): number {
  return Math.min(
    Math.max(insets.bottom, TAB_BAR_FLOAT_INSET),
    TAB_BAR_FLOAT_BOTTOM_MAX,
  );
}

/** The capsule's own height: the row, plus its padding on both sides. */
export const TAB_BAR_CAPSULE_HEIGHT = TAB_BAR_ROW_HEIGHT + TAB_BAR_PADDING_TOP * 2;

/**
 * What a scrolling screen has to leave clear at the bottom.
 *
 * The capsule, the gap under it, and one more step so the last row of a list
 * stops above the bar rather than tucking under its edge.
 */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_CAPSULE_HEIGHT + tabBarFloatBottom(insets) + spacing.md;
}

/**
 * Where the capsule's midline sits, in points down from the top of the screen.
 *
 * What `chromeToneFor` needs to know to decide whether the bar is still over a
 * screen's dark ground — see the note there on why the midline and not an
 * edge. Derived from the same three values that position the bar, so the
 * answer cannot drift from where it is actually drawn.
 */
export function useTabBarMidline(viewportHeight: number): number {
  const insets = useSafeAreaInsets();
  return viewportHeight - tabBarFloatBottom(insets) - TAB_BAR_CAPSULE_HEIGHT / 2;
}
