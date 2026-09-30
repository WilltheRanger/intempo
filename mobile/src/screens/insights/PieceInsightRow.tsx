import { StyleSheet } from 'react-native';

import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import type { PieceInsight } from '../../data/types';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET } from '../../design';
import { readPieceWord } from '../../lib/insights/tendency';
import { sessionLabel } from '../../lib/format';

export interface PieceInsightRowProps {
  insight: PieceInsight;
  onPress: () => void;
}

/**
 * One piece in Insights' list, on one line: its title and how it has gone,
 * in the result screen's words ("Rushed", "Held the tempo").
 *
 * **Words, not a rail** (the owner, 2026-09-29, the same call as the Library
 * tiles): the slider bar between them was the old vocabulary. The composer
 * and the session count went into the spoken label.
 *
 * It opens the piece: a screen that names your pieces and measures them and
 * then does not open them is a report rather than an app.
 */
export function PieceInsightRow({ insight, onPress }: PieceInsightRowProps) {
  // "Tempo wandered" where a direction would be false — see `readPieceWord`.
  const word = readPieceWord(insight);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${insight.title}. ${word} across ${sessionLabel(insight.sessions)}.`}
      activeScale={0.99}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text variant="metadata" numberOfLines={1} style={styles.title}>
        {insight.title}
      </Text>
      <Text variant="metadataSmall" color="textSecondary" numberOfLines={1} style={styles.word}>
        {word}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: MIN_TOUCH_TARGET,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.55,
  },
  title: {
    flex: 1,
  },
  word: {
    textAlign: 'right',
  },
});
