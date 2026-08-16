import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import { Text } from './Text';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers, e.g. "Score view". */
  label: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Two or three mutually exclusive views of the same thing.
 *
 * Used where the point is comparison — flipping between them in place, so what
 * differs is the content and not its position on screen.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={[styles.track, style]}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && !selected && styles.segmentPressed,
            ]}
          >
            <Text
              variant="button"
              color={selected ? 'textPrimary' : 'textSecondary'}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surfacePressed,
    borderRadius: radii.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: BORDER_WIDTH,
    borderColor: 'transparent',
  },
  segmentSelected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  segmentPressed: {
    borderColor: colors.borderStrong,
  },
});
