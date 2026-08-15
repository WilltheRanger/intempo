import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '../../design';
import type { Piece } from '../../data/types';
import { Card } from '../primitives/Card';
import { ProgressBar } from '../primitives/ProgressBar';
import { Text } from '../primitives/Text';
import { ScoreThumbnail } from './ScoreThumbnail';

export interface PieceCardProps {
  piece: Piece;
  onPress?: () => void;
}

const THUMBNAIL_SIZE = 64;

/**
 * A piece in a list. Compact enough to browse.
 *
 * Score, title, composer, progress — in that order of priority, and nothing
 * else. Exact dates and counts belong on the piece detail screen; repeating
 * them on every row is what makes a library tiring to scan.
 */
export function PieceCard({ piece, onPress }: PieceCardProps) {
  const content = (
    <View style={styles.row}>
      <ScoreThumbnail source={piece.thumbnail} style={styles.thumbnail} />

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
      </View>
    </View>
  );

  if (!onPress) {
    return <Card padded={false}>{content}</Card>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        piece.composer ? `${piece.title}, ${piece.composer}` : piece.title
      }
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <Card padded={false}>{content}</Card>
    </Pressable>
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
    padding: spacing.md,
    gap: spacing.lg,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
  },
  details: {
    flex: 1,
    // Keeps short rows from collapsing tighter than the thumbnail.
    minHeight: THUMBNAIL_SIZE,
    justifyContent: 'center',
  },
  composer: {
    marginTop: spacing.xs,
  },
  progress: {
    marginTop: spacing.md,
  },
});
