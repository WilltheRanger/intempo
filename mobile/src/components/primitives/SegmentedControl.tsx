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
            // **react-native-web does not derive this from
            // `accessibilityState`.** Without it a screen reader announces
            // "Notation, tab" and "Original, tab" and never which one is
            // showing — and selection here is carried by a fill, so that is
            // the only signal there was.
            aria-selected={selected}
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
    // The full 44, not `MIN_TOUCH_TARGET - spacing.sm`. The subtraction made
    // the *track* 44 tall, which looks like it satisfies the floor and does
    // not: the `Pressable` is what receives the tap, and the track's padding
    // around it is not tappable. The control is 52 tall now, which is the
    // honest cost of a target you can actually hit with an instrument in your
    // hands.
    minHeight: MIN_TOUCH_TARGET,
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
