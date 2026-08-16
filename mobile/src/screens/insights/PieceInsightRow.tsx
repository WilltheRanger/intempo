import { StyleSheet } from 'react-native';

import { Card } from '../../components/primitives/Card';
import { MetadataRow } from '../../components/primitives/MetadataRow';
import { Text } from '../../components/primitives/Text';
import type { PieceInsight } from '../../data/types';
import { spacing } from '../../design';
import { formatVerdict } from '../../lib/tempo';
import { DeviationBar } from './DeviationBar';

export interface PieceInsightRowProps {
  insight: PieceInsight;
}

/** One piece's tempo record: what it was, how it went, how often. */
export function PieceInsightRow({ insight }: PieceInsightRowProps) {
  const verdict = formatVerdict(insight.verdict);

  return (
    <Card>
      <Text variant="pieceTitle" numberOfLines={2}>
        {insight.title}
      </Text>

      {insight.composer ? (
        <Text
          variant="metadata"
          color="textSecondary"
          style={styles.composer}
        >
          {insight.composer}
        </Text>
      ) : null}

      <DeviationBar
        deviationPct={insight.meanDeviationPct}
        accessibilityLabel={`${verdict} across ${insight.title}`}
        style={styles.bar}
      />

      <MetadataRow
        variant="metadataSmall"
        items={[verdict, sessionLabel(insight.sessions)]}
        style={styles.meta}
      />
    </Card>
  );
}

function sessionLabel(sessions: number): string {
  return sessions === 1 ? '1 session' : `${sessions} sessions`;
}

const styles = StyleSheet.create({
  composer: {
    marginTop: spacing.xs,
  },
  bar: {
    marginTop: spacing.lg,
  },
  meta: {
    marginTop: spacing.sm,
  },
});
