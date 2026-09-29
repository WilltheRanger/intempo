import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import { colors, spacing, type ColorToken } from '../../design';

/**
 * What the bar charts' colours mean, in words (2026-09-29).
 *
 * A first-time walk met green, brown, red and grey bars with nothing saying
 * which was which — and red beside green is the pair a colour-blind reader
 * cannot tell apart, so the words are the key, not the swatches.
 */
export interface ChartKeyItem {
  tone: ColorToken;
  label: string;
}

export const TEMPO_KEY: readonly ChartKeyItem[] = [
  { tone: 'verdictOn', label: 'On tempo' },
  { tone: 'verdictMid', label: 'A little off' },
  { tone: 'verdictBad', label: 'Well off' },
  { tone: 'chartRule', label: 'Not timed' },
];

export const PITCH_KEY: readonly ChartKeyItem[] = [
  { tone: 'verdictOn', label: 'In tune' },
  { tone: 'verdictMid', label: 'A little out' },
  { tone: 'verdictBad', label: 'Well out' },
  { tone: 'chartRule', label: 'Not read' },
];

export function ChartKey({ items }: { items: readonly ChartKeyItem[] }) {
  return (
    <View style={styles.row} accessible={false} importantForAccessibility="no-hide-descendants">
      {items.map((item) => (
        <View key={item.label} style={styles.item}>
          <View style={[styles.swatch, { backgroundColor: colors[item.tone] }]} />
          <Text variant="metadataSmall" color="textTertiary">
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
});
