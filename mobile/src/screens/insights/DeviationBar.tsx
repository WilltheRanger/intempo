import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BORDER_WIDTH, colors, radii, type ColorToken } from '../../design';
import type { Tolerance } from '../../data/types';
import { fullScaleFor, sharedFullScaleFor } from '../../lib/tempo';

const TRACK_HEIGHT = 4;
const CENTRE_HEIGHT = 12;

export interface DeviationBarProps {
  /** Percentage of one beat. Positive is ahead of the beat. */
  deviationPct: number;
  /**
   * Fill colour. Defaults to the accent; the verdict screen passes a verdict
   * colour, which is the only place those are allowed.
   */
  fill?: ColorToken;
  /**
   * The thresholds this take was judged by, which set where the bar pins.
   * Full deflection is the outer threshold — beyond it the pipeline calls a
   * take severe — so a pinned bar means exactly that, rather than a number
   * chosen to make the bar look right.
   *
   * Null for takes analysed before the pipeline recorded them; `fullScaleFor`
   * owns that fallback.
   */
  tolerance: Tolerance | null;
  /**
   * Draw both ways out to this distance instead of one way to `deviationPct`.
   *
   * **For a musician whose drift has no side.** `deviationPct` is signed, so a
   * take 18% ahead in one bar and 18% behind in the next averages to zero and
   * this bar draws nothing — under a headline that says the tempo wanders.
   * That is the same contradiction between a word and its picture that the
   * headline itself was fixed for, one element lower down.
   *
   * A symmetric fill is not a decoration on the signed reading; it is the
   * honest drawing of a different quantity, so the caller passes it only when
   * that is the quantity being reported (`TendencyReading.showsSpread`).
   */
  spreadPct?: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * How far a take sat from the beat, and which side of it.
 *
 * The fill grows from a centre line rather than from the left edge, because
 * the quantity is signed — a left-anchored bar can show that a musician
 * drifted but not whether they drifted ahead or behind, which is the whole
 * question.
 *
 * The fill is the accent everywhere except the verdict screen, which passes a
 * verdict colour. Either way the word beside it carries the judgement — the
 * bar only ever has to carry the magnitude.
 */
export function DeviationBar({
  deviationPct,
  tolerance,
  spreadPct,
  fill = 'accent',
  accessibilityLabel,
  style,
}: DeviationBarProps) {
  const spread = spreadPct !== undefined;
  // The shared scale when the fill runs both ways, since one bar cannot use a
  // different scale on each side of its own centre.
  const fullScale = spread
    ? sharedFullScaleFor(tolerance)
    : fullScaleFor(tolerance, deviationPct);
  const value = spread ? spreadPct : deviationPct;
  const clamped = Math.max(-1, Math.min(1, value / fullScale));
  // Half the track is one full deflection, so a fraction of it is that
  // fraction of 50%.
  const width = `${Math.abs(clamped) * 50}%` as const;
  const ahead = clamped >= 0;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, style]}
    >
      <View style={styles.track} />

      <View
        style={[
          styles.fill,
          { width, backgroundColor: colors[fill] },
          spread || ahead ? styles.fillAhead : styles.fillBehind,
        ]}
      />
      {spread ? (
        <View
          style={[
            styles.fill,
            { width, backgroundColor: colors[fill] },
            styles.fillBehind,
          ]}
        />
      ) : null}

      {/* Drawn last so the reference stays visible through the fill. */}
      <View style={styles.centre} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: CENTRE_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    backgroundColor: colors.border,
    borderRadius: radii.pill,
  },
  fill: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: radii.pill,
  },
  fillAhead: {
    left: '50%',
  },
  fillBehind: {
    right: '50%',
  },
  centre: {
    position: 'absolute',
    left: '50%',
    width: BORDER_WIDTH,
    height: CENTRE_HEIGHT,
    // Darker than the hairlines elsewhere, and deliberately so: the whole bar
    // is read relative to this mark, and at border weight it disappears into
    // the track it sits on.
    backgroundColor: colors.textTertiary,
  },
});
