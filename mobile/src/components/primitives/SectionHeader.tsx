import { Pressable, StyleSheet, View } from 'react-native';

import { MIN_TOUCH_TARGET, spacing } from '../../design';
import { Text } from './Text';

export interface SectionHeaderProps {
  label: string;
  /** Optional trailing action, e.g. "See all". */
  actionLabel?: string;
  onActionPress?: () => void;
}

/**
 * A quiet label above a group of content, optionally with one action.
 *
 * Sentence case — the brief rules out decorative uppercase labels.
 */
export function SectionHeader({
  label,
  actionLabel,
  onActionPress,
}: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text variant="sectionLabel" color="textSecondary">
        {label}
      </Text>

      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={hitSlop}
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}
        >
          <Text variant="sectionAction" color="accent">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Lifts the tap target to the comfortable minimum without growing the label. */
const hitSlop = {
  top: (MIN_TOUCH_TARGET - 18) / 2,
  bottom: (MIN_TOUCH_TARGET - 18) / 2,
  left: spacing.md,
  right: spacing.md,
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
});
