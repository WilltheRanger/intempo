import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  spacing,
} from '../../design';

export interface LinkRowProps {
  label: string;
  /** Current state, shown before the chevron — an address, a count. */
  value?: string;
  onPress: () => void;
  /** Hairline above the row. Omit on the first row in a group. */
  divided?: boolean;
}

/**
 * A settings row that opens something else.
 *
 * The chevron is the whole point: it separates rows that go somewhere from
 * rows that only report a value, which otherwise look identical.
 */
export function LinkRow({
  label,
  value,
  onPress,
  divided = true,
}: LinkRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [
        styles.row,
        divided && styles.divided,
        pressed && styles.pressed,
      ]}
    >
      <Text variant="button" style={styles.label}>
        {label}
      </Text>

      <View style={styles.trailing}>
        {value ? (
          <Text
            variant="metadata"
            color="textTertiary"
            numberOfLines={1}
            style={styles.value}
          >
            {value}
          </Text>
        ) : null}
        <ChevronRight
          size={ICON_SIZE.md}
          strokeWidth={ICON_STROKE_WIDTH}
          color={colors.textTertiary}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.lg,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    flexShrink: 0,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    /**
     * **`flexShrink` alone does not shrink it on the web build.** A flex item's
     * CSS `min-width` is `auto`, which is its content, so a long unbreakable
     * value — an email address — pushed the row past the screen edge with
     * `numberOfLines={1}` set and never truncating. Measured at 2x type:
     * "you@example.com" ran 11pt off a 390pt screen.
     *
     * React Native's own layout treats this as 0 already, so it is a no-op on
     * device and a fix in the one place these screens can be driven.
     */
    minWidth: 0,
  },
  value: {
    flexShrink: 1,
    minWidth: 0,
  },
});
