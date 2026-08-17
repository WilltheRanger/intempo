import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '../../design';
import type { Piece } from '../../data/types';
import { formatLastPracticed, formatProgressPercent } from '../../lib/format';
import { PressableScale } from '../motion';
import { Card } from '../primitives/Card';
import { MetadataRow } from '../primitives/MetadataRow';
import { ProgressBar } from '../primitives/ProgressBar';
import { Text } from '../primitives/Text';
import { ScoreThumbnail } from './ScoreThumbnail';

export interface PieceCardProps {
  piece: Piece;
  onPress?: () => void;
  /**
   * Adds a percentage and last-practiced line under the progress bar.
   *
   * Off by default, which keeps Today's preview exactly as approved. The
   * Library turns it on: that screen is where a musician decides what to work
   * on next, and "practiced three weeks ago" is the deciding signal.
   */
  showPracticeDetail?: boolean;
  /**
   * The Library's row treatment: tighter vertical padding for browsing many
   * rows at once, and a wider gutter between thumbnail and text.
   *
   * Off by default so Today's preview keeps its approved proportions.
   */
  dense?: boolean;
}

/**
 * Every row uses this exact box, whatever the source image's proportions.
 *
 * Slightly landscape rather than square: the score images are single-staff
 * strips around 8:1, so a shorter box crops less off the sides and the
 * notation stays recognisable without the thumbnail taking more width.
 */
const THUMBNAIL_WIDTH = 56;
const THUMBNAIL_HEIGHT = 40;

/**
 * The Library trades 4pt of thumbnail width for 4pt of gutter, so the text
 * column keeps the width it has in Today's preview. Without this the wider
 * gutter alone wraps "60 Studies for the Violin, Op. 45", orphaning "45" on
 * a second line.
 */
const THUMBNAIL_WIDTH_DENSE = 52;

/**
 * A piece in a list. Compact enough to browse.
 *
 * Score, title, composer, progress — in that order of priority, and nothing
 * else. Exact dates and counts belong on the piece detail screen; repeating
 * them on every row is what makes a library tiring to scan.
 */
export function PieceCard({
  piece,
  onPress,
  showPracticeDetail = false,
  dense = false,
}: PieceCardProps) {
  const content = (
    <View style={[styles.row, dense && styles.rowDense]}>
      <ScoreThumbnail
        source={piece.thumbnail}
        style={[styles.thumbnail, dense && styles.thumbnailDense]}
      />

      <View style={styles.details}>
        <Text variant="pieceTitle" numberOfLines={2}>
          {piece.title}
        </Text>

        {piece.composer ? (
          <Text
            variant="composer"
            color="textSecondary"
            numberOfLines={1}
            style={styles.composer}
          >
            {piece.composer}
          </Text>
        ) : null}

        <ProgressBar
          value={piece.progress}
          height={3}
          accessibilityLabel={`Progress through ${piece.title}`}
          style={styles.progress}
        />

        {showPracticeDetail ? (
          <MetadataRow
            variant="metadataSmall"
            items={[
              formatProgressPercent(piece.progress),
              formatLastPracticed(piece.lastPracticedAt),
            ]}
            style={styles.practiceDetail}
          />
        ) : null}
      </View>
    </View>
  );

  if (!onPress) {
    return <Card padded={false}>{content}</Card>;
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        piece.composer ? `${piece.title}, ${piece.composer}` : piece.title
      }
      style={styles.pressable}
    >
      <Card padded={false}>{content}</Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: radii.md,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
    opacity: 0.9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    gap: spacing.lg,
  },
  rowDense: {
    paddingVertical: spacing.xs,
    // Gives the thumbnail air on its right before the text column starts.
    // Scoped here rather than applied to every row: the extra 4pt narrows the
    // text column enough to wrap titles that currently fit on one line in
    // Today's preview, and Today is frozen.
    gap: spacing.xl,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    // Centred against the text block so one- and two-line rows both align.
    alignSelf: 'center',
  },
  thumbnailDense: {
    width: THUMBNAIL_WIDTH_DENSE,
  },
  details: {
    flex: 1,
    // Keeps short rows from collapsing tighter than the thumbnail.
    minHeight: THUMBNAIL_HEIGHT,
    justifyContent: 'center',
  },
  composer: {
    marginTop: spacing.xs,
  },
  progress: {
    marginTop: spacing.sm,
  },
  practiceDetail: {
    marginTop: spacing.sm,
  },
});
