import { Play } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Card } from '../../components/primitives/Card';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { Text } from '../../components/primitives/Text';
import type { Piece } from '../../data/types';
import { spacing } from '../../design';
import { formatWorkingTempo } from '../../lib/tempo';

export interface PracticeCardProps {
  piece: Piece;
  /** The tempo this piece is being worked at, from `practiceTempo`. */
  workingBpm: number;
  /**
   * How the last take of *this piece* went — the pipeline's own sentence.
   *
   * It lives on the card rather than in a block of its own because it is about
   * the piece on the card. `getCurrentPiece` resolves through the newest
   * analysis, so the piece you are continuing and the piece you last recorded
   * are the same piece by construction; a separate "Last take" section was a
   * second copy of this card with a sentence attached.
   */
  lastTakeHeadline: string | null;
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
 * A card, deliberately — this is the one thing on the screen that genuinely
 * needs grouping (§3 law 3): a piece, its tempo and the action that starts it
 * are one object, and the rows below are separate suggestions rather than more
 * of the same. The action lives inside it so it reads as "continue *this*"
 * rather than as a floating global button.
 *
 * **"Practiced today" is gone too.** It was the third grey line in a stack of
 * three, above the one sentence on the card anybody opens the app to read. The
 * card now says what the piece is, what tempo it is being worked at, and how
 * the last take went — and stops.
 *
 * **The progress bar and percentage are gone.** They rendered `piece.progress`,
 * which `sources/api.ts` maps to null with the note that there is no progress
 * concept anywhere in the schema — so they were fixture-only ornament, and they
 * were also the reason this card and a Library row looked identical. The
 * working tempo replaces them: real, stored per piece, and until now visible
 * only on the Record screen.
 */
export function PracticeCard({
  piece,
  workingBpm,
  lastTakeHeadline,
  onContinue,
}: PracticeCardProps) {
  return (
    <Card emphasis padded={false}>
      <ScoreThumbnail source={piece.thumbnail} radius={0} style={styles.banner} />

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

        <Text variant="metadata" color="textTertiary" style={styles.tempo}>
          {formatWorkingTempo(workingBpm, piece.markedBpm)}
        </Text>

        {lastTakeHeadline ? (
          <Text variant="metadataSmall" color="textSecondary" style={styles.verdict}>
            {lastTakeHeadline}
          </Text>
        ) : null}

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
  tempo: {
    marginTop: spacing.md,
  },
  verdict: {
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.md,
  },
});
