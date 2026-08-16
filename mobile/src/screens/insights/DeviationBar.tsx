import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BORDER_WIDTH, colors, radii } from '../../design';

/**
 * Deviation at which the bar reaches full deflection, in BPM.
 *
 * Twice the threshold where the spec starts calling a take "rushing", so a bar
 * that pins is genuinely off rather than merely outside the tolerance band.
 */
const FULL_SCALE_BPM = 10;

const TRACK_HEIGHT = 4;
const CENTRE_HEIGHT = 12;

export interface DeviationBarProps {
  /** Positive is ahead of the beat. */
  bpmDeviation: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * How far a take sat from the beat, and which side of it.
 *
 * The fill grows from a centre line rather than from the left edge, because
 * the quantity is signed — a left-anchored bar can show that a musician
 * drifted but not whether they drifted ahead or behind, which is the whole
 * question. Nothing is encoded in colour: the verdict word beside the bar
 * carries the judgement, so the bar only has to carry the magnitude.
 */
export function DeviationBar({
  bpmDeviation,
  accessibilityLabel,
  style,
}: DeviationBarProps) {
  const clamped = Math.max(-1, Math.min(1, bpmDeviation / FULL_SCALE_BPM));
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
          { width },
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
    backgroundColor: colors.accent,
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
