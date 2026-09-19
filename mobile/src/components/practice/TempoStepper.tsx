import { Minus, Plus } from '../icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_BPM, MIN_BPM } from '../../data/practiceTempo';
import { spacing } from '../../design';
import { ROW_PADDING_VERTICAL } from '../rowMetrics';
import { IconButton } from '../primitives/IconButton';
import { Text } from '../primitives/Text';

/** Two BPM a tap. Fine enough to find a tempo, coarse enough to get there. */
export const BPM_STEP = 2;

export interface TempoStepperProps {
  label: string;
  bpm: number;
  /** Given the new value, in this control's displayed beat unit. */
  onChange: (bpm: number) => void;
  unitLabel?: string;
  minBpm?: number;
  maxBpm?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Forwarded to the two buttons: `plain` when this stepper is itself on a
   * glass surface. Glass inside glass has no ground to refract, and the sweep
   * calls it GLASS ON GLASS.
   */
  surface?: 'glass' | 'plain';
  /**
   * How much of the screen this is allowed to be.
   *
   * `hero` is the warmup page, where choosing a tempo is what the screen is
   * for and the number should be the largest thing on it.
   *
   * `row` is the record screen, where it is not. There the number was
   * `screenTitle` beneath a record button, and the two of them were a pair of
   * focal points arguing (§3 law 4) — a musician glancing at the sheet had to
   * decide which of the two large things was the subject. As a row it reads
   * as one of the settings it belongs with, keeps its ± where a thumb can nudge
   * it, and leaves the record button alone.
   *
   * A density rather than a second component: the step, the limits and the
   * accessible names are the whole of this control, and two copies of those is
   * how the second one stops being updated. It is also why the row keeps the
   * word "Target tempo" and a separate `BPM` leaf — the walk reads the number
   * by finding `BPM` and taking the line before it.
   */
  density?: 'hero' | 'row';
}

/**
 * The tempo you are working at, and the two taps that change it.
 *
 * Extracted from the Record screen so the warmup page adjusts tempo with the
 * same control rather than a lookalike — two steppers that disagree about
 * their step size or their limits is the kind of drift nobody notices until a
 * musician does.
 */
export function TempoStepper({
  label,
  bpm,
  onChange,
  unitLabel = 'BPM',
  minBpm = MIN_BPM,
  maxBpm = MAX_BPM,
  disabled = false,
  style,
  surface = 'glass',
  density = 'hero',
}: TempoStepperProps) {
  const row = density === 'row';

  const minus = (
    <IconButton
      icon={Minus}
      label="Slower"
      onPress={() => onChange(bpm - BPM_STEP)}
      disabled={disabled || bpm <= minBpm}
      surface={surface}
    />
  );
  const plus = (
    <IconButton
      icon={Plus}
      label="Faster"
      onPress={() => onChange(bpm + BPM_STEP)}
      disabled={disabled || bpm >= maxBpm}
      surface={surface}
    />
  );

  if (row) {
    return (
      <View style={[styles.row, style]}>
        <Text variant="button" style={styles.rowLabel}>
          {label}
        </Text>
        <View style={styles.rowStepper}>
          {minus}
          <View style={styles.rowReading}>
            <Text variant="pieceTitle" style={styles.bpm}>
              {bpm}
            </Text>
            <Text variant="metadataSmall" color="textTertiary">
              {unitLabel}
            </Text>
          </View>
          {plus}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.tempo, style]}>
      <Text variant="sectionLabel" color="textSecondary">
        {label}
      </Text>

      <View style={styles.tempoRow}>
        {minus}
        <View style={styles.reading}>
          <Text variant="screenTitle" style={styles.bpm}>
            {bpm}
          </Text>
          <Text variant="metadata" color="textTertiary">
            {unitLabel}
          </Text>
        </View>
        {plus}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tempo: {
    alignItems: 'center',
    gap: spacing.md,
  },
  tempoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2xl'],
  },
  reading: {
    alignItems: 'center',
    minWidth: 96,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  rowLabel: {
    // Takes the slack, so the stepper sits against the right margin and lines
    // up with the values on the rows below it.
    flex: 1,
  },
  rowStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowReading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing.xs,
    // Wide enough for three digits and the unit, so the two buttons hold still
    // as the number changes.
    minWidth: 78,
  },
  bpm: {
    // Digits change every step; without this the row twitches as widths shift.
    fontVariant: ['tabular-nums'],
  },
});
