import { Play } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import type { Piece } from '../../data/types';
import { formatLastPracticed, formatProgressPercent } from '../../lib/format';
import { Card } from '../primitives/Card';
import { MetadataRow } from '../primitives/MetadataRow';
import { PrimaryButton } from '../primitives/PrimaryButton';
import { ProgressBar } from '../primitives/ProgressBar';
import { Text } from '../primitives/Text';
import { ScoreThumbnail } from './ScoreThumbnail';

export interface FeaturedPieceCardProps {
  piece: Piece;
  onContinue: () => void;
}

/**
 * Height of the score strip across the top of the card.
 *
 * A shorter strip also shows more of the score: the source images are roughly
 * 8:1, so with `cover` a shallower box crops less off the sides.
 */
const BANNER_HEIGHT = 56;

/**
 * The piece to pick back up. The dominant element on the Today screen.
 *
 * The action lives inside the card rather than at the bottom of the screen, so
 * it reads as "continue *this*" rather than as a floating global button.
 */
export function FeaturedPieceCard({ piece, onContinue }: FeaturedPieceCardProps) {
  const percent = formatProgressPercent(piece.progress);
  const lastPracticed = formatLastPracticed(piece.lastPracticedAt);

  return (
    <Card emphasis padded={false}>
      <ScoreThumbnail
        source={piece.thumbnail}
        radius={0}
        style={styles.banner}
      />

      <View style={styles.body}>
        <Text variant="heroTitle" numberOfLines={2}>
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

        {piece.movement ? (
          <Text
            variant="metadata"
            color="textTertiary"
            numberOfLines={1}
            style={styles.movement}
          >
            {piece.movement}
          </Text>
        ) : null}

        <ProgressBar
          value={piece.progress}
          accessibilityLabel={`Progress through ${piece.title}`}
          style={styles.progress}
        />

        <MetadataRow items={[percent, lastPracticed]} style={styles.metadata} />

        <PrimaryButton
          label="Continue practice"
          icon={Play}
          onPress={onContinue}
          style={styles.action}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    height: BANNER_HEIGHT,
  },
  body: {
    // Vertical is tighter than horizontal: the card needed height back, but
    // narrowing the side gutters would crowd the title against the border.
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  composer: {
    marginTop: spacing.xs,
  },
  movement: {
    marginTop: spacing.xs,
  },
  progress: {
    marginTop: spacing.md,
  },
  metadata: {
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
  },
});
