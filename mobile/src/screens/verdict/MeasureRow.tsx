import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import type { MeasureVerdict, Tolerance } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { readMeasure } from '../../lib/verdict/measureReading';
import { DeviationBar } from '../insights/DeviationBar';

/**
 * The fixed columns either side of the bar, exported so the legend above the
 * list can sit over the bar itself rather than over the middle of the card.
 */
export const MEASURE_COLUMNS = {
  number: 24,
  verdict: 78,
  gap: spacing.md,
  gutter: spacing.lg,
} as const;

export interface MeasureRowProps {
  measure: MeasureVerdict;
  /** The take's thresholds, which set where the bar pins. */
  tolerance: Tolerance | null;
  revealed: boolean;
  onToggle: () => void;
  /** Hairline above the row. Omit on the first in a group. */
  divided?: boolean;
  /**
   * Shown under the row while it is revealed — the correction prompt.
   *
   * Passed in rather than built here so this component keeps knowing nothing
   * about analyses or mutations, and so the screen that owns the request owns
   * the state of it too.
   */
  revealedExtra?: ReactNode;
}

/**
 * One measure of the take: its number, how far it sat from the beat, and the
 * word for it.
 *
 * Words by default, every row the same. Tapping selects a row — it warms, its
 * number firms up, and the word gives way to the figure behind it. The spec
 * keeps timing numbers out of the interface by default and allows exactly
 * this: one row at a time, asked for, never the thing you land on.
 */
export function MeasureRow({
  measure,
  tolerance,
  revealed,
  onToggle,
  divided = true,
  revealedExtra,
}: MeasureRowProps) {
  // What this row says, and whether its bar and its figure mean anything.
  // A bar under a written `rit.` is not judged — see `readMeasure`.
  const reading = readMeasure(measure);
  const tone = reading.tone;
  const showFigure = revealed && reading.revealsFigure;

  return (
    /*
      **The prompt is a sibling of the row, not a child of it.** The whole row
      is one `Pressable`, and a button inside it would fire the row's own press
      as well — collapsing the reveal on the very tap that answers its
      question. The tint moves out here so it covers both.
    */
    <View style={showFigure ? styles.revealedGroup : undefined}>
    <Pressable
      // **Not a button when there is nothing behind it.** These rows have no
      // figure to reveal — the bar was not timed — so a tap highlighted them
      // and did nothing, under a line that says "Tap a measure for its
      // timing." A control that answers nothing is worse than no control
      // (§3 law 10). The explanation is still in the label, read as text.
      onPress={reading.revealsFigure ? onToggle : undefined}
      accessibilityRole={reading.revealsFigure ? 'button' : 'text'}
      accessibilityState={
        reading.revealsFigure ? { selected: revealed } : undefined
      }
      aria-pressed={reading.revealsFigure ? revealed : undefined}
      accessibilityLabel={reading.accessibilityLabel}
      accessibilityHint={
        reading.revealsFigure
          ? 'Shows the timing figure for this measure.'
          : undefined
      }
      // The selected tint runs the full width of the card; the hairline inside
      // stays inset. A band that stops short of the edges reads as a floating
      // block rather than as a row of the list.
      style={({ pressed }) => [
        styles.row,
        pressed && reading.revealsFigure && styles.pressed,
      ]}
    >
      <View style={[styles.inner, divided && styles.divided]}>
        <Text
          variant="metadata"
          color={showFigure ? 'textPrimary' : 'textTertiary'}
          style={styles.number}
        >
          {measure.measure}
        </Text>

        {/*
          **Zero, not the measured number, when the bar was not timed.** The
          scale is distance from a steady beat, and the page has said there is
          no steady beat here to be distant from. Drawing the real deviation
          rendered a bar pushed hard to one side next to the words for no
          error — and the deviation is real, it just is not a mistake.
        */}
        <DeviationBar
          deviationPct={reading.showsDeviation ? measure.deviationPct : 0}
          tolerance={tolerance}
          fill={tone}
          accessibilityLabel={reading.label}
          style={styles.bar}
        />

        {/*
          The word carries the verdict; the colour repeats it. Revealing the
          figure keeps the colour, so the row doesn't change meaning on tap.
        */}
        <Text variant="metadataSmall" color={tone} style={styles.verdict}>
          {showFigure ? formatOffset(measure.deviationPct) : reading.label}
        </Text>
      </View>
    </Pressable>

      {showFigure && revealedExtra ? (
        <View style={styles.extra}>{revealedExtra}</View>
      ) : null}
    </View>
  );
}

/** `+12%` ahead, `-8%` behind. Only ever shown on demand. */
function formatOffset(deviationPct: number): string {
  const rounded = Math.round(deviationPct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: MEASURE_COLUMNS.gutter,
  },
  /*
    **No tint, because there was never one.** This style set
    `backgroundColor: colors.bg` under a comment about "the page colour,
    borrowed onto the card" — and the measure list has no card: it sits
    directly on the screen, which is already `colors.bg`. Measured on the
    running build, a revealed row and an ordinary one are both `#F7F2E9`. The
    rule painted the page colour onto the page.

    Not replaced with a colour that *would* show. The reveal is already
    unmistakable — the number firms to ink, the word gives way to the figure,
    and the prompt opens underneath — so a band as well would be a fourth
    signal for one state (§3 law 10). The group survives because the prompt
    has to be a sibling of the row's `Pressable` rather than a child of it.
  */
  revealedGroup: {},
  extra: {
    // Aligned with the bar, not the card edge, so the question hangs off the
    // measure number's column rather than starting a new one.
    paddingLeft:
      MEASURE_COLUMNS.gutter + MEASURE_COLUMNS.number + MEASURE_COLUMNS.gap,
    paddingRight: MEASURE_COLUMNS.gutter,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: MEASURE_COLUMNS.gap,
    paddingVertical: spacing.md,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  number: {
    width: MEASURE_COLUMNS.number,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  bar: {
    flex: 1,
  },
  verdict: {
    width: MEASURE_COLUMNS.verdict,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
