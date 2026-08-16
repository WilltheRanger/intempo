import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';

import { FeaturedPieceCard } from '../../components/pieces/FeaturedPieceCard';
import { PieceCard } from '../../components/pieces/PieceCard';
import {
  Avatar,
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SectionHeader,
} from '../../components/primitives';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import type { Piece } from '../../data/types';
import { spacing } from '../../design';
import { getGreeting } from '../../lib/greeting';
import type { TabScreenNavigation } from '../../navigation/types';

/** How many pieces the library preview shows before "See all". */
const PREVIEW_LIMIT = 3;

const AVATAR_SIZE = 36;

/**
 * Tappable box around the mark.
 *
 * Bigger than the mark, and pulled back in by the difference so the header row
 * keeps the height the greeting gives it — a taller row would push the whole
 * screen down. `hitSlop` would have done this too, but only on device: it has
 * no effect under react-native-web, so the target couldn't be verified in the
 * one place this build can be driven. A real box behaves the same everywhere.
 */
const AVATAR_TARGET = 48;
const AVATAR_INSET = (AVATAR_TARGET - AVATAR_SIZE) / 2;

export function TodayScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Today'>>();
  const currentPiece = useCurrentPiece();
  const library = useLibrary();
  const me = useMe();

  // Progress and last-practiced move while the app is closed, so the gesture
  // has something real to fetch.
  async function refresh() {
    await Promise.all([currentPiece.refetch(), library.refetch(), me.refetch()]);
  }

  function openPractice(piece: Piece) {
    // Straight to a take. `Practice` remains the score-reading shell; the
    // thing someone means by "continue practicing" is recording one.
    navigation.navigate('Record', { pieceId: piece.id });
  }

  // The featured piece leads the screen; repeating it in the preview below
  // just makes the list look shorter than it is.
  const preview = (library.data ?? [])
    .filter((piece) => piece.id !== currentPiece.data?.id)
    .slice(0, PREVIEW_LIMIT);

  return (
    <ScreenContainer onRefresh={refresh}>
      <PageHeader
        title={getGreeting()}
        // Held back until the account resolves: an avatar that appears as a
        // fallback glyph and then changes into the musician's own letter is
        // worse than one that arrives a frame late.
        action={
          me.data ? (
            <Pressable
              onPress={() => navigation.navigate('Profile')}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              style={({ pressed }) => [
                styles.avatar,
                pressed && styles.pressed,
              ]}
            >
              <Avatar source={me.data.avatarUrl} size={AVATAR_SIZE} />
            </Pressable>
          ) : null
        }
      />

      <ContinueSection
        piece={currentPiece.data ?? null}
        isPending={currentPiece.isPending}
        isError={currentPiece.isError}
        onContinue={openPractice}
      />

      {preview.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            label="Your library"
            actionLabel="See all"
            onActionPress={() => navigation.navigate('Library')}
          />
          <View style={styles.list}>
            {preview.map((piece) => (
              <PieceCard key={piece.id} piece={piece} />
            ))}
          </View>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

interface ContinueSectionProps {
  piece: Piece | null;
  isPending: boolean;
  isError: boolean;
  onContinue: (piece: Piece) => void;
}

function ContinueSection({
  piece,
  isPending,
  isError,
  onContinue,
}: ContinueSectionProps) {
  if (isPending) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load your pieces"
        description="Check your connection and pull to try again."
      />
    );
  }

  if (!piece) {
    return (
      <EmptyState
        title="Nothing to practice yet"
        description="Photograph a piece of sheet music and it will show up here."
      />
    );
  }

  return (
    <View>
      <SectionHeader label="Continue practicing" />
      <FeaturedPieceCard piece={piece} onContinue={() => onContinue(piece)} />
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: AVATAR_TARGET,
    height: AVATAR_TARGET,
    margin: -AVATAR_INSET,
    alignItems: 'center',
    justifyContent: 'center',
    // No vertical nudge: the row centres the mark on the greeting's line box,
    // and the greeting's ink — cap of "G" down to the tail of "g" — is centred
    // in that box to within a fifth of a point. Measured off the rendered
    // type, not the font metrics. Shifting to the cap band instead would lift
    // the mark 4.5pt and leave it riding above the word.
  },
  pressed: {
    opacity: 0.6,
  },
  section: {
    marginTop: spacing['3xl'],
  },
  list: {
    gap: spacing.md,
  },
});
