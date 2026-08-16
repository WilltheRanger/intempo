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
  MIN_TOUCH_TARGET,
  spacing,
} from '../design';
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
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
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
              color={focused ? colors.accent : colors.textSecondary}
            />
            <Text
              variant="sectionLabel"
              color={focused ? 'accent' : 'textSecondary'}
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
    paddingTop: spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    gap: spacing.xs,
  },
  label: {
    textAlign: 'center',
  },
});
