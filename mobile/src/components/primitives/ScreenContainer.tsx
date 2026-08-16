import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BORDER_WIDTH, colors, spacing } from '../../design';
import { useTabBarHeight } from '../../navigation/tabBarMetrics';

export interface ScreenContainerProps {
  children: ReactNode;
  /** Wrap content in a ScrollView. Screens that own their own list say false. */
  scrollable?: boolean;
  /** Extra padding at the bottom so content clears the tab bar. */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Action pinned below the scroll area.
   *
   * For screens whose content grows without bound — a scan can be four pages
   * or thirty — so the action that ends the screen stays one tap away instead
   * of one long scroll away.
   */
  footer?: ReactNode;
}

/**
 * The shared screen shell: warm page background, top safe-area inset, and the
 * standard horizontal gutter.
 *
 * Only the top edge is claimed here — the tab bar handles the bottom inset, so
 * claiming it twice would double the gap.
 */
export function ScreenContainer({
  children,
  scrollable = true,
  contentStyle,
  footer,
}: ScreenContainerProps) {
  // The context tells us *whether* a tab bar is below us — it's absent on
  // screens pushed above the tabs, like Practice. It does not tell us how
  // tall ours is: with a custom `tabBar` React Navigation publishes its own
  // 49pt default rather than measuring what we render. So take presence from
  // the context and the height from the bar's own tokens.
  const hasTabBar = useContext(BottomTabBarHeightContext) != null;
  const tabBarHeight = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const barHeight = hasTabBar ? tabBarHeight : 0;

  // A footer ends the scroll area early, so content scrolls clear of it on its
  // own — no measuring, and no padding that has to be kept in sync with
  // whatever the footer holds. Without one the content still has to clear the
  // tab bar itself, since that bar overlays the screen.
  const bottomInset = {
    paddingBottom: spacing['2xl'] + (footer ? 0 : barHeight),
  };

  // The footer takes over the bottom edge: the home indicator on a phone that
  // has one, the tab bar on the rare screen that has both.
  const footerInset = {
    paddingBottom: hasTabBar
      ? tabBarHeight
      : Math.max(insets.bottom, spacing.lg),
  };

  const scrollArea = scrollable ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, bottomInset, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, bottomInset, contentStyle]}>
      {children}
    </View>
  );

  return (
    // `edges={['top']}` pads by the inset the device actually reports, so a
    // Dynamic Island (59pt), an older notch (47pt), and a flat-top phone
    // (20pt) each get the right gap with no per-device branching. The bar
    // below owns the bottom inset; claiming it here too would double it.
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {scrollArea}

      {footer ? (
        // Same construction as the tab bar: page background behind a hairline
        // rule, not a raised surface. Content passes above the rule and stops.
        <View style={[styles.footer, footerInset]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

/** The horizontal gutter, exported so full-bleed sections can cancel it out. */
export const SCREEN_GUTTER = spacing.xl;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SCREEN_GUTTER,
  },
  footer: {
    backgroundColor: colors.bg,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.lg,
  },
});
