import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives';
import type { MeasureVerdict, TempoBeatUnit, Tolerance } from '../../data/types';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { barTempo } from '../../lib/verdict/barTempo';
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
  targetBpm,
  tempoBeatUnit,
  correction,
}: {
  measure: MeasureVerdict;
  tolerance: Tolerance | null;
  targetBpm: number;
  tempoBeatUnit: TempoBeatUnit | null | undefined;
  correction: ReactNode;
}) {
  const reading = readMeasure(measure);
  // The bar's tempo against the target where there is one — "85 BPM", "19
  // under your 104" — rather than how far it sat behind a target held since
  // the first note, which a steadily slower take grows without bound: bar 22
  // of the owner's take was "More than a beat behind" (2026-09-25).
  const tempo = barTempo(measure, targetBpm, tempoBeatUnit, tolerance);
  const detail = tempo
    ? tempo.detail
    : reading.revealsFigure
      ? deviationWords(measure.deviationPct, measure.direction)
      : null;

  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.row}>
        <Text variant="body" style={styles.number}>
          {measure.measure}
        </Text>
        <DeviationBar
          deviationPct={
            tempo ? tempo.deviationPct : reading.showsDeviation ? measure.deviationPct : 0
          }
          tolerance={tolerance}
          fill={tempo ? tempo.tone : reading.tone}
          accessibilityLabel={tempo ? tempo.spoken : reading.accessibilityLabel}
          style={styles.bar}
        />
        <Text
          variant="body"
          color={tempo ? tempo.tone : reading.tone}
          style={styles.verdict}
        >
          {tempo ? tempo.label : reading.label}
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
    // At least the width "Rushing" needs, and wider for "106 BPM".
    minWidth: 78,
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
