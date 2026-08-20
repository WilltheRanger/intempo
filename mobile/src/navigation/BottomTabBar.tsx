import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  ChartLine,
  House,
  Library,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../components/primitives/Text';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  spacing,
} from '../design';
import {
  TAB_BAR_MIN_PADDING_BOTTOM,
  TAB_BAR_PADDING_TOP,
  TAB_BAR_ROW_HEIGHT,
} from './tabBarMetrics';
import type { TabParamList } from './types';

const TAB_ICONS: Record<keyof TabParamList, LucideIcon> = {
  Today: House,
  Library,
  Insights: ChartLine,
  Profile: User,
};

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
            navigation.navigate(route.name);
          }
        }

        return (
          <Pressable
            key={route.key}
            onPress={handlePress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={styles.tab}
          >
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
  label: {
    textAlign: 'center',
  },
});
