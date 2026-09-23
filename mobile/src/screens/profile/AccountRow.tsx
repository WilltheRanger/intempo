import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, spacing } from '../../design';
import { ROW_PADDING_VERTICAL } from '../../components/rowMetrics';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';

export interface AccountRowProps {
  label: string;
  /** What the row says on its right: "Free", "2 of 3 this month". */
  value?: string | null;
  /** Makes the row a link: a chevron on the right, and the whole row pressable. */
  onPress?: () => void;
  /**
   * The hairline above. Off for the first row under a section heading, which
   * already has its rule: two lines round a heading boxed it like an empty row.
   */
  ruled?: boolean;
}

/**
 * One ruled row on Profile (`redesign/Profile.dc.html`): the name in ink, and
 * either a fact in secondary or a chevron — both `rowLabel`, the size of every
 * list row in the app.
 *
 * **Every row carries its own top hairline, the first included.** The section
 * heading above sits on a heavier rule (`RuledHeading`, `borderStrong`), so
 * the first hairline is what starts the list rather than a doubled line.
 */
export function AccountRow({ label, value = null, onPress, ruled = true }: AccountRowProps) {
  const body = (
    <>
      <Text variant="rowLabel" color="textPrimary" style={styles.label}>
        {label}
      </Text>
      {value ? (
        <Text variant="rowLabel" color="textSecondary" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <TrailingChevron />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, ruled && styles.ruled]}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [styles.row, ruled && styles.ruled, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  ruled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.55,
  },
  label: {
    flex: 1,
  },
  value: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'right',
  },
});
