import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives';
import type {
  MeasureVerdict,
  TakeIntonation,
  TempoBeatUnit,
  Tolerance,
} from '../../data/types';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { barTempo, tempoScale } from '../../lib/verdict/barTempo';
import { deviationWords } from '../../lib/verdict/deviationWords';
import { pitchWords } from '../../lib/verdict/intonation';
import { readMeasure } from '../../lib/verdict/measureReading';
import { DeviationBar } from '../insights/DeviationBar';
import { TempoScale } from './TempoScale';

/**
 * The measure the chart has selected (`redesign/Verdict.dc.html`): "Bar 24"
 * and its tempo, a scale with the musician's tempo notched in the middle and
 * the bar's as a dot (`TempoScale`), how far under or over, and — where the
 * app made a claim — "What did you hear?". An older result with no tempo
 * keeps the bar of how far it sat from the beat.
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
  intonation = null,
  wrongNotes = [],
}: {
  measure: MeasureVerdict;
  tolerance: Tolerance | null;
  targetBpm: number;
  tempoBeatUnit: TempoBeatUnit | null | undefined;
  correction: ReactNode;
  /** The take's pitch bands, so the bar's pitch can be said beside its tempo. */
  intonation?: TakeIntonation | null;
  /** This bar's notes heard as other notes: "We heard F where the page has F♯." */
  wrongNotes?: string[];
}) {
  const reading = readMeasure(measure);
  // The bar's tempo against the target where there is one — "85 BPM", "19
  // under your 104" — rather than how far it sat behind a target held since
  // the first note, which a steadily slower take grows without bound: bar 22
  // of the owner's take was "More than a beat behind" (2026-09-25).
  const tempo = barTempo(measure, targetBpm, tempoBeatUnit, tolerance);
  const timing = tempo
    ? tempo.detail
    : reading.revealsFigure
      ? deviationWords(measure.deviationPct, measure.direction)
      : null;
  // Its pitch, where the take was read for it: "17 under your 104 · 12 cents
  // flat". One line, because it is one bar.
  const pitch =
    intonation && measure.pitchCents != null
      ? pitchWords(measure.pitchCents, intonation)
      : null;
  const detail = [timing, pitch].filter(Boolean).join(' · ') || null;

  const tone = tempo ? tempo.tone : reading.tone;

  return (
    <View style={styles.card} accessible={false}>
      {/*
        "Bar 24", not a bare 24: on its own the number read as a score, not
        as which bar this is (the owner, 2026-09-25).
      */}
      <View style={styles.head}>
        <Text variant="body" style={styles.number}>
          Bar {measure.measure}
        </Text>
        <Text variant="body" color={tone} style={styles.verdict}>
          {tempo ? tempo.label : reading.label}
        </Text>
      </View>
      {tempo ? (
        <TempoScale
          scale={tempoScale(tempo, tolerance)}
          accessibilityLabel={tempo.spoken}
          style={styles.picture}
        />
      ) : (
        // An older result, or a bar with no tempo of its own: how far it sat
        // from the beat, as before.
        <DeviationBar
          deviationPct={reading.showsDeviation ? measure.deviationPct : 0}
          tolerance={tolerance}
          fill={reading.tone}
          accessibilityLabel={reading.accessibilityLabel}
          style={styles.picture}
        />
      )}
      {detail ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.detail}>
          {detail}
        </Text>
      ) : null}
      {/*
        What the bar was played as, where a note was clearly another one — the
        owner's choice (2026-09-26) to name them. In ink rather than grey: it
        is the one line here about the notes rather than the time, and a
        misread page is fixed from exactly this bar.
      */}
      {wrongNotes.map((line) => (
        <Text key={line} variant="metadataSmall" style={styles.detail}>
          {line}
        </Text>
      ))}
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
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 14,
  },
  number: {
    fontSize: 15,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  verdict: {
    textAlign: 'right',
    fontSize: 15,
    lineHeight: 20,
  },
  picture: {
    marginTop: spacing.md,
  },
  detail: {
    marginTop: spacing.sm,
  },
  correction: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
});
