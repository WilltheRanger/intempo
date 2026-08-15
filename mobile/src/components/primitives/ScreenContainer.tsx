import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../../design';

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
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {scrollable ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.content, contentStyle]}>
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
    paddingBottom: spacing['4xl'],
  },
});
