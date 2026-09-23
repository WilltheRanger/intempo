import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight } from '../../components/icons';
import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, spacing } from '../../design';

export interface AccountRowProps {
  label: string;
  /** What the row says on its right: "Free", "2 of 3 this month". */
  value?: string | null;
  /** Makes the row a link: a chevron on the right, and the whole row pressable. */
  onPress?: () => void;
}

/**
 * One ruled row on Profile (`redesign/Profile.dc.html`): the name in 13pt
 * medium ink, and either a fact in 15pt secondary or a chevron.
 *
 * **Every row carries its own top hairline, the first included.** The section
 * heading above sits on a heavier rule (`RuledHeading`, `borderStrong`), so
 * the first hairline is what starts the list rather than a doubled line.
 *
 * The label is the smaller of the two on purpose: the rows are read down the
 * right-hand side — the plan, the count, the version — and the left-hand side
 * is the index to them.
 */
export function AccountRow({ label, value = null, onPress }: AccountRowProps) {
  const body = (
    <>
      <Text variant="sectionLabel" color="textPrimary" style={styles.label}>
        {label}
      </Text>
      {value ? (
        <Text color="textSecondary" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <ChevronRight size={17} strokeWidth={1.6} color={colors.textTertiary} />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
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
    paddingVertical: 14,
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
    fontSize: 15,
    lineHeight: 20,
  },
});
