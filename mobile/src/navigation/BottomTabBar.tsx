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

import { GlassSurface } from '../components/primitives/GlassSurface';
import { Text } from '../components/primitives/Text';
import {
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  EASE_OUT,
  motion,
  spacing,
} from '../design';
import {
  TAB_BAR_FLOAT_BOTTOM,
  TAB_BAR_FLOAT_INSET,
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
 * The tab bar: a floating glass capsule with content passing beneath it.
 *
 * **This reverses design law 9**, which called bottom navigation "opaque,
 * anchored, unrounded, part of the frame". The law is rewritten rather than
 * quietly overridden — see `DECISIONS.md`, 2026-09-06 — because a rule left
 * standing in `CLAUDE.md` while the code contradicts it is how the next
 * session "fixes" this back.
 *
 * Two things it deliberately does **not** do, both of which were prototyped and
 * rejected:
 *
 * - **It does not resize on scroll.** Furniture that changes size while you
 *   read is chrome asking to be looked at, which is the opposite of what
 *   furniture is for. iOS 26 shrinks its tab bar; this one does not.
 * - **It has no pill behind the active tab.** A filled selection chip is a
 *   Material convention. iOS marks the selection on the symbol and the label,
 *   which is what the accent and the ink weight already do here.
 *
 * The accent colour marks the active tab and nothing else.
 */
export function BottomTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  // The safe-area inset is the *gap under the capsule* now, not padding inside
  // it: a floating bar must clear the home indicator without swallowing it, and
  // a capsule with 34pt of dead space in its bottom half is not a capsule. The
  // floor still only applies when the device reports no inset.
  const bottomGap =
    Math.max(insets.bottom, TAB_BAR_MIN_PADDING_BOTTOM) + TAB_BAR_FLOAT_BOTTOM;

  return (
    <GlassSurface
      radius={CAPSULE_RADIUS}
      style={[
        styles.bar,
        {
          left: TAB_BAR_FLOAT_INSET,
          right: TAB_BAR_FLOAT_INSET,
          bottom: bottomGap,
        },
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
    </GlassSurface>
  );
}

/**
 * A capsule, so the radius is half the bar's height and is never guessed.
 *
 * Derived rather than typed, because the row height is itself derived from the
 * icon size and the label's line height — a literal here goes stale the moment
 * either of those moves, and a not-quite-capsule reads as a mistake.
 */
const CAPSULE_RADIUS = (TAB_BAR_PADDING_TOP + TAB_BAR_ROW_HEIGHT) / 2;

const styles = StyleSheet.create({
  bar: {
    // Absolutely positioned so content scrolls *under* it. `ScreenContainer`
    // pays for that by adding `useTabBarHeight()` to its bottom padding, so the
    // last row of any list is still reachable above the capsule.
    position: 'absolute',
    flexDirection: 'row',
    paddingTop: TAB_BAR_PADDING_TOP,
    paddingBottom: TAB_BAR_PADDING_TOP,
  },
  /*
    **Above the glass.** `GlassSurface` fills the control absolutely, and a
    positioned element paints over its non-positioned siblings whatever the DOM
    order — so without this the material covers each tab instead of sitting
    behind it. Measured: the header's "+" rendered pale grey rather than ink.
  */
  tab: {
    zIndex: 1,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: TAB_BAR_ROW_HEIGHT,
    gap: spacing.xs,
  },
  tabPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.975 }],
  },
  tabPressedStill: {
    opacity: 0.82,
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
