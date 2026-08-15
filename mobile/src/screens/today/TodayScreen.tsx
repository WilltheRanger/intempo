import { useNavigation } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { FeaturedPieceCard } from '../../components/pieces/FeaturedPieceCard';
import { PieceCard } from '../../components/pieces/PieceCard';
import {
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  SectionHeader,
} from '../../components/primitives';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import type { Piece } from '../../data/types';
import { spacing } from '../../design';
import { formatTodayDate, getGreeting } from '../../lib/greeting';
import type { TabScreenNavigation } from '../../navigation/types';

/** How many pieces the library preview shows before "See all". */
const PREVIEW_LIMIT = 3;

export function TodayScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Today'>>();
  const currentPiece = useCurrentPiece();
  const library = useLibrary();

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
      <PageHeader eyebrow={formatTodayDate()} title={getGreeting()} />

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
  section: {
    marginTop: spacing['3xl'],
  },
  list: {
    gap: spacing.md,
  },
});
