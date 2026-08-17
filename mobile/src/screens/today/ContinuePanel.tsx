import { StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { Text } from '../../components/primitives/Text';
import type { Piece, PieceInsight } from '../../data/types';
import { spacing } from '../../design';
import { formatLastPracticed } from '../../lib/format';
import { formatTendencyDetail, formatWorkingTempo } from '../../lib/tempo';

export interface ContinuePanelProps {
  piece: Piece;
  /** This piece's recent practice, when there is any. */
  insight: PieceInsight | null;
  /** The tempo this piece is being worked at, from `practiceTempo`. */
  workingBpm: number;
}

/**
 * How tall the sheet strip is.
 *
 * Larger than the thumbnail this replaces, because it is now the only image on
 * the screen and it is the piece you are about to play — worth actually
 * reading a bar or two of. The source crops are around 8:1, so a full-bleed
 * strip at this height shows most of a system rather than a sliver.
 */
const SHEET_HEIGHT = 200;

/**
 * The piece to pick back up — the whole of the Today screen's content.
 *
 * **Not a card.** It used to be one, and that was the single thing making
 * Today look like a shorter Library: the same white rounded box, the same
 * title-composer-bar-metadata stack. On its own on the page it can use the
 * type scale for hierarchy instead of a border (§3 laws 3 and 8), and the
 * screen reads as one thing rather than as a list with one entry.
 *
 * The sentence under the title is the reason this piece is here. It comes from
 * real analyses via `PracticeInsights`, and it is framed as an aggregate —
 * "across 9 sessions" — because that is what the data is. A claim about the
 * last take specifically would need the last take, which is a different query.
 */
export function ContinuePanel({ piece, insight, workingBpm }: ContinuePanelProps) {
  const lastPracticed = formatLastPracticed(piece.lastPracticedAt);

  return (
    <View>
      {/*
        Full-bleed: the gutter is cancelled so the music runs edge to edge.
        Sheet music is the app's visual identity, and inset by 20pt it reads as
        an illustration of the piece rather than as the piece.
      */}
      <ScoreThumbnail
        source={piece.thumbnail}
        radius={0}
        style={styles.sheet}
      />

      {insight ? (
        <Text variant="body" color="textSecondary" style={styles.reason}>
          {formatTendencyDetail(insight.verdict, insight.sessions)}
        </Text>
      ) : lastPracticed ? (
        <Text variant="body" color="textSecondary" style={styles.reason}>
          {lastPracticed}.
        </Text>
      ) : (
        <Text variant="body" color="textSecondary" style={styles.reason}>
          Not recorded yet.
        </Text>
      )}

      <Text variant="metadata" color="textTertiary" style={styles.tempo}>
        {formatWorkingTempo(workingBpm, piece.markedBpm)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    height: SHEET_HEIGHT,
    marginHorizontal: -SCREEN_GUTTER,
    marginTop: spacing['2xl'],
  },
  reason: {
    marginTop: spacing['2xl'],
  },
  tempo: {
    marginTop: spacing.sm,
  },
});
