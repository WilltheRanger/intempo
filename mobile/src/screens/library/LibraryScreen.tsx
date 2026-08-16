import { useNavigation } from '@react-navigation/native';
import { Library, Plus, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PieceCard } from '../../components/pieces/PieceCard';
import {
  EmptyState,
  LoadingState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SearchField,
  Text,
} from '../../components/primitives';
import { useLibrary } from '../../data/hooks/usePieces';
import type { Piece } from '../../data/types';
import { motion, spacing } from '../../design';
import type {
  AddPieceOption,
  TabScreenNavigation,
} from '../../navigation/types';
import { AddPieceSheet } from './AddPieceSheet';

/** Case- and accent-insensitive match across title and composer. */
function matches(piece: Piece, query: string): boolean {
  const needle = normalise(query);
  if (!needle) {
    return true;
  }
  return (
    normalise(piece.title).includes(needle) ||
    normalise(piece.composer ?? '').includes(needle)
  );
}

/**
 * Strips diacritics so "Etudes" finds "Études" and "Saint-Saens" finds
 * "Saint-Saëns" — classical repertoire is full of accents that nobody types.
 */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function LibraryScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Library'>>();
  const library = useLibrary();

  async function refresh() {
    await library.refetch();
  }
  const [query, setQuery] = useState('');

  const pieces = useMemo(() => library.data ?? [], [library.data]);
  const results = useMemo(
    () => pieces.filter((piece) => matches(piece, query)),
    [pieces, query],
  );

  const [addSheetVisible, setAddSheetVisible] = useState(false);

  function handleSelectOption(option: AddPieceOption) {
    setAddSheetVisible(false);
    // Let the sheet finish dismissing before the push, so the two animations
    // don't overlap.
    setTimeout(() => {
      if (option === 'scan') {
        navigation.navigate('Scanner');
        return;
      }
      navigation.navigate('AddPiece', { option });
    }, motion.fast);
  }

  return (
    <ScreenContainer onRefresh={refresh}>
      <PageHeader
        title="Library"
        action={
          <PrimaryButton
            label="Add piece"
            icon={Plus}
            onPress={() => setAddSheetVisible(true)}
            haptic={false}
            size="compact"
          />
        }
      />

      {/* Nothing to search through until there's a repertoire. */}
      {pieces.length > 0 ? (
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search your library"
        />
      ) : null}

      <LibraryContent
        isPending={library.isPending}
        isError={library.isError}
        pieces={pieces}
        results={results}
        query={query}
        onClearSearch={() => setQuery('')}
        onOpenPiece={(piece) =>
          navigation.navigate('PieceDetail', { pieceId: piece.id })
        }
      />

      <AddPieceSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        onSelect={handleSelectOption}
      />
    </ScreenContainer>
  );
}

interface LibraryContentProps {
  isPending: boolean;
  isError: boolean;
  pieces: Piece[];
  results: Piece[];
  query: string;
  onClearSearch: () => void;
  onOpenPiece: (piece: Piece) => void;
}

function LibraryContent({
  isPending,
  isError,
  pieces,
  results,
  query,
  onClearSearch,
  onOpenPiece,
}: LibraryContentProps) {
  if (isPending) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load your library"
        description="Check your connection and try again."
      />
    );
  }

  if (pieces.length === 0) {
    return (
      // No action here: the primary Add piece button sits directly above.
      <EmptyState
        icon={Library}
        title="No pieces yet"
        description="Add a piece and it will appear here, ready to practice."
      />
    );
  }

  if (results.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No matches"
        description={`Nothing in your library matches “${query.trim()}”.`}
        actionLabel="Clear search"
        onActionPress={onClearSearch}
      />
    );
  }

  return (
    <View style={styles.section}>
      {/*
        Tertiary information, so it's quieter than a section heading — this is
        a count, not a label introducing a group.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.count}>
        {countLabel(results.length, Boolean(query.trim()))}
      </Text>
      <View style={styles.list}>
        {results.map((piece) => (
          <PieceCard
            key={piece.id}
            piece={piece}
            showPracticeDetail
            dense
            onPress={() => onOpenPiece(piece)}
          />
        ))}
      </View>
    </View>
  );
}

function countLabel(count: number, searching: boolean): string {
  const noun = count === 1 ? 'piece' : 'pieces';
  return searching ? `${count} ${noun} found` : `${count} ${noun}`;
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
  },
  count: {
    marginBottom: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
});
