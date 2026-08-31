import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives';
import type { TempoRung } from '../../data/practiceTempo';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';

export interface TempoLadderProps {
  rungs: TempoRung[];
  onSelect: (bpm: number) => void;
}

/**
 * A short set of playable tempos, not a progress percentage.
 *
 * Each rung is a real value the Record screen accepts. Selecting one updates
 * the same per-piece working tempo used by the practice card and recorder, so
 * this never becomes a decorative plan that disagrees with the next take.
 */
export function TempoLadder({ rungs, onSelect }: TempoLadderProps) {
  return (
    <View>
      <Text variant="body" color="textSecondary">
        Choose the tempo for your next take. Small, clean steps beat one big jump.
      </Text>

      <View style={styles.rungs}>
        {rungs.map((rung) => (
          <Pressable
            key={rung.bpm}
            onPress={() => onSelect(rung.bpm)}
            accessibilityRole="button"
            accessibilityLabel={`${rung.label}, ${rung.bpm} BPM`}
            accessibilityState={{ selected: rung.selected }}
            style={({ pressed }) => [
              styles.rung,
              rung.selected && styles.selected,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="sectionLabel" color="textSecondary">
              {rung.label}
            </Text>
            <Text variant="screenTitle" style={styles.value}>
              {rung.bpm}
            </Text>
            <Text variant="metadataSmall" color="textTertiary">
              BPM
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rungs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  rung: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfacePressed,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
    borderColor: colors.borderStrong,
  },
  value: {
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
});
