import { StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import type { Piece } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { formatLastPracticedShort, joinMetadata } from '../../lib/format';

export interface PieceRowProps {
  piece: Piece;
  onPress: () => void;
  /** The last row in a group draws no rule — the group heading below ends it. */
  last?: boolean;
}

const THUMBNAIL_WIDTH = 52;
const THUMBNAIL_HEIGHT = 38;

/**
 * One piece, as an index entry.
 *
 * **Not a card.** A library is the one screen where density is the point: you
 * are scanning forty titles to find one, and a white rounded box around each
 * of them adds 24pt of padding and a border per row while grouping information
 * that is already a single line of text (§3 law 3). Rules between rows do the
 * separating for a pixel each.
 *
 * The age rides in the metadata line rather than in a right-hand column. It
 * had its own column first, and the column cost the title 70pt — enough that
 * "42 Études ou Caprices, No. 2" wrapped with the "2" alone on a line, and
 * every row grew to two lines to make room for a value the group heading above
 * it already tells you coarsely. The heading does the scanning; the row only
 * has to be exact.
 */
export function PieceRow({ piece, onPress, last = false }: PieceRowProps) {
  const age = formatLastPracticedShort(piece.lastPracticedAt);
  const meta = joinMetadata([piece.composer, age]);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        piece.composer ? `${piece.title}, ${piece.composer}` : piece.title
      }
      // Barely there: a whole row scaling is a lurch, where a card the size of
      // a thumb is not.
      activeScale={0.99}
    >
      <View style={[styles.row, !last && styles.ruled]}>
        <ScoreThumbnail source={piece.thumbnail} style={styles.thumbnail} />

        <View style={styles.details}>
          <Text variant="pieceTitle" numberOfLines={2}>
            {piece.title}
          </Text>
          {meta ? (
            <Text
              variant="metadataSmall"
              color="textSecondary"
              numberOfLines={1}
              style={styles.meta}
            >
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  ruled: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
  },
  details: {
    flex: 1,
  },
  meta: {
    marginTop: 2,
  },
});
