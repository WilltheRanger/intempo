import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors } from '../../design';

const DOT = 10;

export interface TakeDotsProps {
  done: number;
  of: number;
}

/**
 * How many takes Insights has of the five it waits for: filled dots for the
 * takes recorded, hollow for the rest (the owner, 2026-09-30, "Count + dots").
 * Announced as one reading, "2 of 5 takes".
 */
export function TakeDots({ done, of }: TakeDotsProps) {
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel={`${done} of ${of} takes`}>
      {Array.from({ length: of }, (_, index) => (
        <View key={index} style={[styles.dot, index < done ? styles.done : styles.todo]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  done: {
    backgroundColor: colors.accent,
  },
  todo: {
    borderWidth: BORDER_WIDTH * 1.5,
    borderColor: colors.chartRule,
  },
});
