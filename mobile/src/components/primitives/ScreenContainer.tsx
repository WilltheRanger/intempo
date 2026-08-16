import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../../design';
import { useTabBarHeight } from '../../navigation/tabBarMetrics';

export interface ScreenContainerProps {
  children: ReactNode;
  /** Wrap content in a ScrollView. Screens that own their own list say false. */
  scrollable?: boolean;
  /** Extra padding at the bottom so content clears the tab bar. */
  contentStyle?: StyleProp<ViewStyle>;
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
}: ScreenContainerProps) {
  // The context tells us *whether* a tab bar is below us — it's absent on
  // screens pushed above the tabs, like Practice. It does not tell us how
  // tall ours is: with a custom `tabBar` React Navigation publishes its own
  // 49pt default rather than measuring what we render. So take presence from
  // the context and the height from the bar's own tokens.
  const hasTabBar = useContext(BottomTabBarHeightContext) != null;
  const tabBarHeight = useTabBarHeight();
  const bottomInset = {
    paddingBottom: spacing['2xl'] + (hasTabBar ? tabBarHeight : 0),
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {scrollable ? (
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
      )}
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
});
