import { Minus, Plus } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_BPM, MIN_BPM } from '../../data/practiceTempo';
import { spacing } from '../../design';
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
}: TempoStepperProps) {
  return (
    <View style={[styles.tempo, style]}>
      <Text variant="sectionLabel" color="textSecondary">
        {label}
      </Text>

      <View style={styles.tempoRow}>
        <IconButton
          icon={Minus}
          label="Slower"
          onPress={() => onChange(bpm - BPM_STEP)}
          disabled={disabled || bpm <= minBpm}
        />
        <View style={styles.reading}>
          <Text variant="screenTitle" style={styles.bpm}>
            {bpm}
          </Text>
          <Text variant="metadata" color="textTertiary">
            {unitLabel}
          </Text>
        </View>
        <IconButton
          icon={Plus}
          label="Faster"
          onPress={() => onChange(bpm + BPM_STEP)}
          disabled={disabled || bpm >= maxBpm}
        />
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
  bpm: {
    // Digits change every step; without this the row twitches as widths shift.
    fontVariant: ['tabular-nums'],
  },
});
