import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, spacing } from '../../design';

export interface AccountRowProps {
  label: string;
  value: string;
  /** Hairline above the row. Omit on the first row in a group. */
  divided?: boolean;
}

/**
 * One account fact: what it is, then what it says.
 *
 * Stacked rather than label-left/value-right because the values include email
 * addresses, and the alternative is truncating one — the field where a missing
 * tail matters most. Same label treatment as `Input`, so a labelled value
 * reads the same whether it can be edited or not.
 */
export function AccountRow({ label, value, divided = true }: AccountRowProps) {
  return (
    <View style={[styles.row, divided && styles.divided]}>
      <Text variant="sectionLabel" color="textSecondary" style={styles.label}>
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.lg,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  label: {
    marginBottom: spacing.sm,
  },
});
