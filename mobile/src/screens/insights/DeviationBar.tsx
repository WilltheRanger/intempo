import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BORDER_WIDTH, colors, radii, type ColorToken } from '../../design';

/**
 * Deviation at which the bar reaches full deflection, as a percentage of one
 * beat.
 *
 * The outer tolerance threshold from `backend/config.toml`: beyond it the
 * pipeline calls a take severe. So a pinned bar means exactly that, rather
 * than a number chosen to make the bar look right.
 *
 * Server-tunable, which this copy is not. When the API exposes the thresholds
 * it should come from there.
 */
const FULL_SCALE_PCT = 20;

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
  fill = 'accent',
  accessibilityLabel,
  style,
}: DeviationBarProps) {
  const clamped = Math.max(-1, Math.min(1, deviationPct / FULL_SCALE_PCT));
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
          ahead ? styles.fillAhead : styles.fillBehind,
        ]}
      />

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
