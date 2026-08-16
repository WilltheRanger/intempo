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

export function TodayScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Today'>>();
  const currentPiece = useCurrentPiece();
  const library = useLibrary();
  const me = useMe();

  function openPractice(piece: Piece) {
    navigation.navigate('Practice', { pieceId: piece.id });
  }

  // The featured piece leads the screen; repeating it in the preview below
  // just makes the list look shorter than it is.
  const preview = (library.data ?? [])
    .filter((piece) => piece.id !== currentPiece.data?.id)
    .slice(0, PREVIEW_LIMIT);

  return (
    <ScreenContainer>
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
              hitSlop={spacing.sm}
              style={({ pressed }) => (pressed ? styles.pressed : undefined)}
            >
              <Avatar source={me.data.avatarUrl} email={me.data.email} />
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
