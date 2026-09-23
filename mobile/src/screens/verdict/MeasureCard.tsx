import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives';
import type { MeasureVerdict, Tolerance } from '../../data/types';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { deviationWords } from '../../lib/verdict/deviationWords';
import { readMeasure } from '../../lib/verdict/measureReading';
import { DeviationBar } from '../insights/DeviationBar';

/**
 * The measure the chart has selected (`redesign/Verdict.dc.html`): its number,
 * where it sat against the beat, the word for it, how far off in shares of a
 * beat, and — where the app made a claim — "What did you hear?".
 *
 * **A card, and the one on this screen that earns it** (§3 law 3): it is a
 * detail about one measure sitting under a chart of all of them, and the box
 * is what says it belongs to the outlined bar rather than to the take.
 *
 * The words are `readMeasure`'s and `deviationWords`', the same the old list
 * rows said, so the redesign changes where they appear and not what they say.
 */
export function MeasureCard({
  measure,
  tolerance,
  correction,
}: {
  measure: MeasureVerdict;
  tolerance: Tolerance | null;
  correction: ReactNode;
}) {
  const reading = readMeasure(measure);
  const detail = reading.revealsFigure
    ? deviationWords(measure.deviationPct, measure.direction)
    : null;

  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.row}>
        <Text variant="body" style={styles.number}>
          {measure.measure}
        </Text>
        <DeviationBar
          deviationPct={reading.showsDeviation ? measure.deviationPct : 0}
          tolerance={tolerance}
          fill={reading.tone}
          accessibilityLabel={reading.accessibilityLabel}
          style={styles.bar}
        />
        <Text variant="body" color={reading.tone} style={styles.verdict}>
          {reading.label}
        </Text>
      </View>
      {detail ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.detail}>
          {detail}
        </Text>
      ) : null}
      {correction ? <View style={styles.correction}>{correction}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  number: {
    width: 26,
    textAlign: 'right',
    fontSize: 15,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  bar: {
    flex: 1,
  },
  verdict: {
    width: 78,
    textAlign: 'right',
    fontSize: 15,
    lineHeight: 20,
  },
  detail: {
    marginTop: spacing.md,
  },
  correction: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
});
