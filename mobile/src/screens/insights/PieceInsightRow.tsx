import { StyleSheet } from 'react-native';

import { PressableScale } from '../../components/motion';
import { MetadataRow } from '../../components/primitives/MetadataRow';
import { Text } from '../../components/primitives/Text';
import { ROW_PADDING_VERTICAL } from '../../components/rowMetrics';
import type { PieceInsight } from '../../data/types';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, spacing } from '../../design';
import { readPieceWord, tempoWanders } from '../../lib/insights/tendency';
import { DeviationBar } from './DeviationBar';
import { sessionLabel } from '../../lib/format';

export interface PieceInsightRowProps {
  insight: PieceInsight;
  /** Opens the piece. A list of your own pieces that does not open them is a table. */
  onPress: () => void;
  /** Hairline above the row. Off on the first of a group — see `rowMetrics`. */
  divided?: boolean;
}

/**
 * One piece's tempo record: what it was, how it went, how often.
 *
 * **Not a card**, for the reason `PieceRow` is not one: this is the same list
 * of the same pieces as the Library, one screen away, and a white rounded box
 * around each entry there and not here would make two lists of one thing look
 * like two things. A rule between rows separates them for a pixel each (§3
 * law 3).
 *
 * It also had no `onPress`. A screen that names your pieces, measures them and
 * then does not open them is a report rather than an app — and it is the one
 * place a musician has just been told which piece needs work.
 */
export function PieceInsightRow({ insight, onPress, divided = false }: PieceInsightRowProps) {
  // "Uneven" where a direction would be false — see `readPieceWord`. Without
  // it a piece a musician plays a long way off the beat on both sides reads
  // "On tempo" in the row they tap to go and practise it.
  const verdict = readPieceWord(insight);
  const wanders = tempoWanders(insight);

  return (
    /*
      **The styling belongs on the pressable, not on a `View` inside it.** This
      row had `activeScale={0.99}` and no pressed style at all — a 1% scale on a
      tall row is close to invisible, so it was the only one of the three piece
      rows that did not visibly answer a finger. Its two near-twins, `PieceRow`
      and `TodayRow`, both add `surfacePressed` here.

      The inner `View` that used to carry `row` and `ruled` is gone with it: a
      pressed background on the wrapper would have painted *outside* the ruled
      element, which is why the styles had to come up rather than the pressed
      state go down.
    */
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${insight.title}. ${verdict} across ${sessionLabel(insight.sessions)}.`}
      activeScale={0.99}
      style={({ pressed }) => [
        styles.row,
        divided && styles.ruled,
        pressed && styles.pressed,
      ]}
    >
      <Text variant="pieceTitle" numberOfLines={2}>
        {insight.title}
      </Text>

      {insight.composer ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.composer}>
          {insight.composer}
        </Text>
      ) : null}

      <DeviationBar
        deviationPct={insight.meanDeviationPct}
        spreadPct={wanders ? insight.spreadPct : undefined}
        tolerance={insight.tolerance}
        accessibilityLabel={`${verdict} across ${insight.title}`}
        style={styles.bar}
      />

      <MetadataRow
        variant="metadataSmall"
        items={[verdict, sessionLabel(insight.sessions)]}
        style={styles.meta}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: ROW_PADDING_VERTICAL,
    minHeight: MIN_TOUCH_TARGET,
  },
  ruled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  composer: {
    marginTop: 2,
  },
  bar: {
    marginTop: spacing.md,
  },
  meta: {
    marginTop: spacing.sm,
  },
});
