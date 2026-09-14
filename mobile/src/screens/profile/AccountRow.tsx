import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, spacing } from '../../design';

export interface AccountRowProps {
  label: string;
  value: string;
  /** Hairline above the row. Omit on the first row in a group. */
  divided?: boolean;
}

/**
 * One account fact: what it is on the left, what it says on the right.
 *
 * **The same shape as `LinkRow`, minus the chevron, and that is the point.**
 * Profile stacks facts and doors in one list, and until 2026-09-14 the two used
 * different grammars — this row put its label *above* its value while `LinkRow`
 * put it beside — so a reader could not tell from the shape of a row whether it
 * opened something. Now the only difference between a fact and a door is the
 * chevron, which is the one difference that means anything.
 *
 * It used to be stacked, for a stated reason: the values "include email
 * addresses, and the alternative is truncating one". That was never true of
 * this component. Every value it has ever been given is short — Plan, Role,
 * Analyses, Studio, Version — and the email lives in `LinkRow`, which already
 * carries the `minWidth: 0` fix for exactly that truncation problem. The value
 * still shrinks here rather than pushing the row off-screen, so a long one
 * degrades instead of breaking the layout.
 */
export function AccountRow({ label, value, divided = true }: AccountRowProps) {
  return (
    <View style={[styles.row, divided && styles.divided]}>
      <Text variant="body" style={styles.label}>
        {label}
      </Text>
      <Text
        variant="body"
        color="textSecondary"
        numberOfLines={1}
        style={styles.value}
      >
        {value}
      </Text>
    </View>
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
  label: {
    flexShrink: 0,
  },
  value: {
    // See `LinkRow`'s note: a flex item's CSS min-width is its content, so an
    // unbreakable value runs off the web build's screen without this.
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'right',
  },
});
