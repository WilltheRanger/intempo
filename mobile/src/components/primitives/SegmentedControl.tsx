import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  fontFamily,
  MIN_TOUCH_TARGET,
  radii,
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
              variant="metadata"
              color={selected ? 'textPrimary' : 'textSecondary'}
              style={selected ? styles.labelSelected : styles.label}
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
  /**
   * The redesign's track (`redesign/Profile.dc.html`): a sunken well with a
   * hairline edge, and the chosen option a white tile inside it with no
   * border of its own — the fill and the weight say which one, not a box.
   */
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surfacePressed,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    // The design draws 34; the finger needs 44, and the finger wins.
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
  },
  segmentPressed: {
    backgroundColor: colors.border,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
  },
  labelSelected: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.sansMedium,
  },
});
