import { useNavigation } from '@react-navigation/native';
import { Library, Plus, Search, X } from '../../components/icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import { PieceListSkeleton } from '../../components/skeletons';
import {
  EmptyState,
  IconButton,
  PageHeader,
  ScreenContainer,
  SearchField,
  SectionHeader,
} from '../../components/primitives';
import { describeLoadError } from '../../data/api/describeError';
import { useLibrary } from '../../data/hooks/usePieces';
import type { Piece } from '../../data/types';
import { spacing } from '../../design';
import { groupByRecency, searchLibrary } from '../../lib/library';
import type {
  TabScreenNavigation,
} from '../../navigation/types';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import { PieceRow } from './PieceRow';
import { useAddPieceOption } from '../../navigation/useAddPieceOption';
import { loadStateFor, type LoadState } from '../../lib/loadState';

export function LibraryScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Library'>>();
  const library = useLibrary();

  async function refresh() {
    await library.refetch();
  }
  const [query, setQuery] = useState('');

  const pieces = useMemo(() => library.data ?? [], [library.data]);
  const results = useMemo(
    () => searchLibrary(pieces, query),
    [pieces, query],
  );

  const [addSheetVisible, setAddSheetVisible] = useState(false);

  /**
   * Whether the search field is on screen.
   *
   * **Collapsed by default, which is a hierarchy decision.** A full-width
   * field and a solid ink button sat between the title and the first piece,
   * and the button — the highest-contrast object on the screen — took the eye
   * before the title did. §3 law 4 allows one dominant focal point and this
   * screen is a list of pieces, so the pieces get it; both controls are now
   * chrome-weight circles and two more rows clear the fold.
   */
  const [searchOpen, setSearchOpen] = useState(false);

  const handleSelectOption = useAddPieceOption(() =>
    setAddSheetVisible(false),
  );

  return (
    <ScreenContainer onRefresh={refresh}>
      <PageHeader
        // The count moves into the eyebrow, where every other screen puts its
        // line of context. As a row of its own it was a third heading between
        // the search field and the first piece.
        eyebrow={pieces.length > 0 ? countLabel(results.length, Boolean(query.trim())) : null}
        title="Library"
        action={
          <View style={styles.actions}>
            {/* Nothing to search through until there's a repertoire. */}
            {pieces.length > 0 ? (
              <IconButton
                icon={searchOpen ? X : Search}
                label={searchOpen ? 'Close search' : 'Search your library'}
                onPress={() => {
                  // Closing clears the query: leaving a filter applied behind a
                  // control you just dismissed is how a library looks empty for
                  // no visible reason.
                  setSearchOpen((open) => {
                    if (open) setQuery('');
                    return !open;
                  });
                }}
              />
            ) : null}
            <IconButton
              icon={Plus}
              label="Add piece"
              onPress={() => setAddSheetVisible(true)}
            />
          </View>
        }
      />

      {searchOpen && pieces.length > 0 ? (
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search your library"
          autoFocus
        />
      ) : null}

      <LibraryContent
        load={loadStateFor({
          isError: library.isError,
          hasData: library.data !== undefined,
        })}
        error={library.error}
        pieces={pieces}
        results={results}
        query={query}
        onClearSearch={() => setQuery('')}
        onRetry={() => void refresh()}
        retrying={library.isFetching}
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
  load: LoadState;
  /** Why, so the empty state can say something true rather than guess. */
  error: unknown;
  pieces: Piece[];
  results: Piece[];
  query: string;
  onClearSearch: () => void;
  onOpenPiece: (piece: Piece) => void;
  /** Fetch again after a failure — see the comment on the error state below. */
  onRetry: () => void;
  retrying: boolean;
}

function LibraryContent({
  load,
  error,
  pieces,
  results,
  query,
  onClearSearch,
  onOpenPiece,
  onRetry,
  retrying,
}: LibraryContentProps) {
  if (load === 'loading') {
    return (
      <View style={styles.section}>
        <PieceListSkeleton count={5} />
      </View>
    );
  }

  if (load === 'unavailable') {
    return (
      // **A load failure is the one empty state that is not empty of options.**
      // It said "check your connection" and gave nothing to press: pull to
      // refresh is invisible, and on the web build with a mouse it does not
      // exist at all. `AccountStartupScreen` has had this button since it was
      // written; the four tabs did not.
      <EmptyState
        title="Couldn't load your library"
        description={describeLoadError(error)}
        actionLabel={retrying ? 'Trying…' : 'Try again'}
        onActionPress={onRetry}
        actionDisabled={retrying}
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

  // Searching flattens the groups. "This week" over a set of results that was
  // filtered by a word is a heading about the wrong thing — when you've typed
  // "Kreutzer" the answer is the matches, in one list.
  const searching = Boolean(query.trim());
  if (searching) {
    return (
      <View style={styles.section}>
        {results.map((piece, index) => (
          <FadeIn key={piece.id} index={index}>
            <PieceRow
              piece={piece}
              last={index === results.length - 1}
              onPress={() => onOpenPiece(piece)}
            />
          </FadeIn>
        ))}
      </View>
    );
  }

  const groups = groupByRecency(results);
  let row = 0;

  return (
    <View style={styles.section}>
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <SectionHeader label={group.label} />
          {group.pieces.map((piece, index) => (
            // The stagger runs across the whole screen rather than restarting
            // per group, so the rows arrive as one sweep instead of four.
            <FadeIn key={piece.id} index={row++}>
              <PieceRow
                piece={piece}
                last={index === group.pieces.length - 1}
                onPress={() => onOpenPiece(piece)}
              />
            </FadeIn>
          ))}
        </View>
      ))}
    </View>
  );
}

function countLabel(count: number, searching: boolean): string {
  const noun = count === 1 ? 'piece' : 'pieces';
  return searching ? `${count} ${noun} found` : `${count} ${noun}`;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  group: {
    // The gap between groups is what a heading needs to belong to the rows
    // below it rather than float between two blocks.
    marginBottom: spacing['2xl'],
  },
});
