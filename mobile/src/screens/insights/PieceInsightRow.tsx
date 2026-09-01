import { StyleSheet, View } from 'react-native';

import { PressableScale } from '../../components/motion';
import { MetadataRow } from '../../components/primitives/MetadataRow';
import { Text } from '../../components/primitives/Text';
import type { PieceInsight } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { formatVerdict } from '../../lib/tempo';
import { DeviationBar } from './DeviationBar';

export interface PieceInsightRowProps {
  insight: PieceInsight;
  /** Opens the piece. A list of your own pieces that does not open them is a table. */
  onPress: () => void;
  /** The last row in a group draws no rule. */
  last?: boolean;
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
export function PieceInsightRow({ insight, onPress, last = false }: PieceInsightRowProps) {
  const verdict = formatVerdict(insight.verdict);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${insight.title}. ${verdict} across ${sessionLabel(insight.sessions)}.`}
      activeScale={0.99}
    >
      <View style={[styles.row, !last && styles.ruled]}>
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
          tolerance={insight.tolerance}
          accessibilityLabel={`${verdict} across ${insight.title}`}
          style={styles.bar}
        />

        <MetadataRow
          variant="metadataSmall"
          items={[verdict, sessionLabel(insight.sessions)]}
          style={styles.meta}
        />
      </View>
    </PressableScale>
  );
}

function sessionLabel(sessions: number): string {
  return sessions === 1 ? '1 session' : `${sessions} sessions`;
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.lg,
  },
  ruled: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
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
