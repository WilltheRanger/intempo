import { Pressable, StyleSheet } from 'react-native';

import { Text } from '../../components/primitives/Text';
import type { MeasureVerdict } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { formatVerdict } from '../../lib/tempo';
import { DeviationBar } from '../insights/DeviationBar';

export interface MeasureRowProps {
  measure: MeasureVerdict;
  revealed: boolean;
  onToggle: () => void;
  /** Hairline above the row. Omit on the first in a group. */
  divided?: boolean;
}

/**
 * One measure of the take: its number, how far it sat from the beat, and the
 * word for it.
 *
 * Tapping swaps the word for the figure behind it. The spec keeps timing
 * numbers out of the interface by default and allows exactly this — a
 * power-user affordance, off on first read, never the thing you land on.
 */
export function MeasureRow({
  measure,
  revealed,
  onToggle,
  divided = true,
}: MeasureRowProps) {
  const verdict = formatVerdict(measure.verdict);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`Measure ${measure.measure}: ${verdict}`}
      accessibilityHint="Shows the timing figure for this measure."
      style={({ pressed }) => [
        styles.row,
        divided && styles.divided,
        pressed && styles.pressed,
      ]}
    >
      <Text variant="metadata" color="textTertiary" style={styles.number}>
        {measure.measure}
      </Text>

      <DeviationBar
        deviationPct={measure.deviationPct}
        accessibilityLabel={verdict}
        style={styles.bar}
      />

      <Text variant="metadataSmall" color="textSecondary" style={styles.verdict}>
        {revealed ? formatOffset(measure.deviationPct) : verdict}
      </Text>
    </Pressable>
  );
}

/** `+12%` ahead, `-8%` behind. Only ever shown on demand. */
function formatOffset(deviationPct: number): string {
  const rounded = Math.round(deviationPct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  number: {
    width: 24,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  bar: {
    flex: 1,
  },
  verdict: {
    width: 78,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
