import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  ChartLine,
  House,
  Library,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../components/primitives/Text';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  EASE_OUT,
  motion,
  spacing,
} from '../design';
import {
  TAB_BAR_MIN_PADDING_BOTTOM,
  TAB_BAR_PADDING_TOP,
  TAB_BAR_ROW_HEIGHT,
} from './tabBarMetrics';
import { impact, ImpactFeedbackStyle } from '../lib/haptics';
import { useReducedMotion } from '../lib/useReducedMotion';
import type { TabParamList } from './types';

const TAB_ICONS: Record<keyof TabParamList, LucideIcon> = {
  Today: House,
  Library,
  Insights: ChartLine,
  Profile: User,
};

function webTabSelectionStyle(focused: boolean): ViewStyle {
  return {
    opacity: focused ? 1 : 0.78,
    transform: [
      { translateY: focused ? -2 : 0 },
      { scale: focused ? 1 : 0.96 },
    ],
    transitionProperty: 'opacity, transform',
    transitionDuration: `${motion.fast}ms`,
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'opacity, transform',
  } as unknown as ViewStyle;
}

function TabSelectionMotion({
  focused,
  children,
}: {
  focused: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const selected = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion || Platform.OS === 'web') {
      selected.setValue(focused ? 1 : 0);
      return;
    }
    const animation = Animated.timing(selected, {
      toValue: focused ? 1 : 0,
      duration: motion.fast,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [focused, reduceMotion, selected]);

  if (reduceMotion) {
    return <View style={styles.tabContent}>{children}</View>;
  }

  return (
    <Animated.View
      style={[
        styles.tabContent,
        Platform.OS === 'web'
          ? webTabSelectionStyle(focused)
          : {
              opacity: selected.interpolate({
                inputRange: [0, 1],
                outputRange: [0.78, 1],
              }),
              transform: [
                {
                  translateY: selected.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -2],
                  }),
                },
                {
                  scale: selected.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The tab bar. Quiet by design — it sits on the page background behind a
 * hairline rule rather than on a raised surface, so it doesn't compete with
 * screen content.
 *
 * The accent colour marks the active tab and nothing else here.
 */
export function BottomTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  return (
    <View
      // Bottom padding is the device's own inset, so the home indicator is
      // cleared on modern iPhones and the bar stays at its approved height on
      // phones without one. The floor only applies when the inset is 0 — it is
      // never added on top of it. `styles.bar` carries the background, so the
      // ivory extends through the safe-area region rather than stopping short.
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, TAB_BAR_MIN_PADDING_BOTTOM) },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = options.title ?? route.name;
        const Icon = TAB_ICONS[route.name as keyof TabParamList] ?? House;

        function handlePress() {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            // A tab change is a small but definite mode switch. Confirm it at
            // the same instant as the visible press, before the scene settles.
            impact(ImpactFeedbackStyle.Light);
            navigation.navigate(route.name);
          }
        }

        return (
          <Pressable
            key={route.key}
            onPress={handlePress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            // Which tab you are on, for a screen reader. The bar is the app's
            // primary furniture and it announced four identical tabs.
            aria-selected={focused}
            accessibilityLabel={label}
            style={({ pressed }) => [
              styles.tab,
              pressed && (reduceMotion ? styles.tabPressedStill : styles.tabPressed),
            ]}
          >
            <TabSelectionMotion focused={focused}>
              <Icon
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE_WIDTH}
                // The icon keeps the gold. Non-text has a 3:1 contrast floor
                // and the accent clears it; text has 4.5:1 and it does not.
                color={focused ? colors.accent : colors.textSecondary}
              />
              <Text
                variant="sectionLabel"
                // Ink rather than gold: at 13px the accent is 3.54:1, under the
                // 4.5:1 floor. The active tab is still marked twice — the gold
                // icon above, and ink against grey here.
                color={focused ? 'textPrimary' : 'textSecondary'}
                style={styles.label}
              >
                {label}
              </Text>
            </TabSelectionMotion>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
    paddingTop: TAB_BAR_PADDING_TOP,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: TAB_BAR_ROW_HEIGHT,
    gap: spacing.xs,
  },
  tabPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.94 }],
  },
  tabPressedStill: {
    opacity: 0.68,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  label: {
    textAlign: 'center',
  },
});
