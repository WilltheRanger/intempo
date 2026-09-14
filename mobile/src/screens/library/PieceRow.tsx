import { StyleSheet, View } from 'react-native';

import { ChevronRight } from '../../components/icons';
import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import type { Piece } from '../../data/types';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import { ROW_PADDING_VERTICAL } from '../../components/rowMetrics';
import { formatLastPracticedShort, joinMetadata } from '../../lib/format';

export interface PieceRowProps {
  piece: Piece;
  onPress: () => void;
  /**
   * Hairline above the row. Off on the first of a group — see `rowMetrics`.
   *
   * This used to be `last`, ruling the bottom edge. Both conventions draw n−1
   * rules and look identical in isolation, which is how the app came to carry
   * both; they only disagree at a group boundary.
   */
  divided?: boolean;
}

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
 *
 * ## No picture of the page, and that is the point
 *
 * Every row used to open with a 52×38 crop of the piece's own first page,
 * signed out of a private bucket. Sheet music is this app's visual identity and
 * that was the argument for it; what it actually cost was one HTTPS fetch of a
 * full-resolution phone photograph *per row*, decoded and downsampled on the
 * client, on the one screen built for scrolling past forty of them. The owner
 * reported the result as "incredibly laggy", and the bandwidth is billed.
 *
 * A thumbnail of a page is also a weak identifier. Every crop is the same
 * thing — a band of staff lines across white paper — at 52pt wide, where the
 * title that distinguishes them is unreadable. It looked like a library and
 * identified nothing.
 *
 * So the row identifies a piece the way an index does: by its name, set in the
 * serif, with the composer and the age in a quiet line under it (§3 law 8 —
 * typography, not containers). The chevron is the one mark, and it does what it
 * depicts: the row opens.
 *
 * The photograph has not gone anywhere. `PieceDetailScreen` still opens with
 * the page as a full-bleed band, which is one image for the one piece you
 * asked about, and `PieceScoreScreen` still shows every page.
 */
export function PieceRow({ piece, onPress, divided = false }: PieceRowProps) {
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
      style={({ pressed }) => [
        styles.row,
        divided && styles.ruled,
        pressed && styles.pressed,
      ]}
    >
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

      {/*
        **A real affordance** (§3): a chevron means it opens, and this row
        opens. It is the only mark on the row, and it replaces the thumbnail as
        the thing that tells the eye where one entry ends and the next begins.
      */}
      <ChevronRight
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textTertiary}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    /*
      **A step looser than it was, and the thumbnail is why.** The picture was
      38pt tall against 43pt of type, so it never set the height — what it set
      was the *rhythm*: a block of ink on the left gave the eye a place to
      start each row and a clear end to the one above. Take it away at the old
      12pt and the rules are the only separation left, 12pt apart, which reads
      as a dense list rather than an index. 16pt puts a one-line entry at 77pt
      against the old 67 and gives the composer line room to sit under the
      title rather than on it.
    */
    paddingVertical: ROW_PADDING_VERTICAL,
    paddingHorizontal: spacing.sm,
    marginHorizontal: -spacing.sm,
    borderRadius: radii.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  ruled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  details: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    marginTop: spacing.xs,
  },
});
