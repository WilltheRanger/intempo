import { StyleSheet, View } from 'react-native';

import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import type { PieceInsight } from '../../data/types';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET } from '../../design';
import { pieceWordTone, readPieceWord, tempoWanders } from '../../lib/insights/tendency';
import { sessionLabel } from '../../lib/format';
import { DeviationBar } from './DeviationBar';

export interface PieceInsightRowProps {
  insight: PieceInsight;
  onPress: () => void;
}

/**
 * One piece in Insights' list, on one line (`redesign/Insights.dc.html`):
 * its title, the tempo rail, and the word for how it has gone.
 *
 * **One line, not a card's worth.** The list sits under "See all pieces" and
 * is for comparing — which of these is furthest off — so every row puts the
 * same three things in the same three columns, and the eye runs down the
 * rails. The composer and the session count went into the spoken label.
 *
 * It opens the piece: a screen that names your pieces and measures them and
 * then does not open them is a report rather than an app.
 */
export function PieceInsightRow({ insight, onPress }: PieceInsightRowProps) {
  // "Uneven" where a direction would be false — see `readPieceWord`.
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
      <View style={styles.rail}>
        <DeviationBar
          deviationPct={insight.meanDeviationPct}
          spreadPct={tempoWanders(insight) ? insight.spreadPct : undefined}
          tolerance={insight.tolerance}
          accessibilityLabel={`${word} across ${insight.title}`}
        />
      </View>
      <Text
        variant="caption"
        color={pieceWordTone(insight)}
        numberOfLines={1}
        style={styles.word}
      >
        {word.toLowerCase()}
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
    width: 120,
    fontSize: 13,
    lineHeight: 18,
  },
  rail: {
    flex: 1,
  },
  word: {
    width: 84,
    textAlign: 'right',
    // 12 is the app's smallest size (`typography.caption`).
    fontSize: 12,
    lineHeight: 16,
  },
});
