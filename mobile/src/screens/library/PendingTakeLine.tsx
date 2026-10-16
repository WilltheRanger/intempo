import { StyleSheet } from 'react-native';

import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { PendingLine } from '../../lib/library/continueLine';

/**
 * The take this device handed over, under the Continue band: one line, and a
 * control in every state — it opens the result when there is one and asks
 * again when there is not (`continueLine.pendingLineFor`).
 */
export function PendingTakeLine({
  line,
  onPress,
}: {
  line: PendingLine;
  /** Undefined while a check is in flight: nothing to do but wait. */
  onPress?: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={line.label}
      activeScale={0.99}
      style={({ pressed }) => [styles.pending, pressed && styles.pressed]}
    >
      <Text variant="metadata" color="textSecondary" numberOfLines={1} style={styles.pendingLabel}>
        {line.label}
      </Text>
      {onPress ? <TrailingChevron /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.55,
  },
  // A row, not a caption: the whole 44pt strip is the target.
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  pendingLabel: {
    flex: 1,
  },
});
