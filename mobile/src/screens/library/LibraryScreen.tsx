import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Library, Plus, Search } from '../../components/icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import { PieceListSkeleton } from '../../components/skeletons';
import {
  EmptyState,
  IconButton,
  ScreenContainer,
  SearchHeader,
} from '../../components/primitives';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import { Text } from '../../components/primitives/Text';
import { describeLoadError } from '../../data/describeLoadError';
import { useInsights } from '../../data/hooks/useInsights';
import { prefetchPieceHistory } from '../../data/hooks/useLatestTake';
import {
  useDeletePiece,
  useLibrary,
  useRetranscribe,
} from '../../data/hooks/usePieces';
import type { Piece, PieceInsight } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { groupByRecency, searchLibrary } from '../../lib/library';
import type {
  TabScreenNavigation,
} from '../../navigation/types';
import { AddPieceSheet } from '../../components/pieces/AddPieceSheet';
import { PieceRow } from './PieceRow';
import { PieceTile } from './PieceTile';
import { useAddPieceOption } from '../../navigation/useAddPieceOption';
import { loadStateFor, type LoadState } from '../../lib/loadState';
import { rowDivided } from '../../components/rowMetrics';

export function LibraryScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Library'>>();
  const queryClient = useQueryClient();
  const library = useLibrary();
  // Each tile's tempo rail: how this piece has sat against the beat across
  // the insights window. Shared cache with the Insights tab, and a tile with
  // no takes in the window simply draws no rail.
  const insights = useInsights();
  const insightByPiece = useMemo(
    () => new Map((insights.data?.pieces ?? []).map((entry) => [entry.pieceId, entry])),
    [insights.data],
  );

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

  /*
    **The shelf can now act on a scan that failed**, which it could not before:
    the only way out of a blank tile was to open the piece, open its score, and
    find the retry there. Nine of them sat in the owner's library for three
    weeks. See `lib/library/tileState` for what the tile says and why.
  */
  const readAgain = useRetranscribe();
  const discard = useDeletePiece();
  const [discarding, setDiscarding] = useState<Piece | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Whichever piece has something running. Read off the mutations rather than
  // held in a third piece of state that could disagree with them.
  const busyPieceId =
    (readAgain.isPending ? readAgain.variables : undefined) ??
    (discard.isPending ? discard.variables : undefined) ??
    null;

  function describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : 'That could not be done. Try again.';
  }

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
  const handleSelectOption = useAddPieceOption(() =>
    setAddSheetVisible(false),
  );

  return (
    <ScreenContainer onRefresh={refresh}>
      {/*
        **The title becomes the field; it does not grow one underneath.** See
        `SearchHeader`, which holds both the crossfade and the reason: the
        field used to mount into the flow on a boolean, so it appeared between
        two frames and pushed the whole shelf down 60 points as it did.
      */}
      <SearchHeader
        title="Library"
        query={query}
        onQueryChange={setQuery}
        placeholder="Search your library"
        searchable={pieces.length > 0}
        action={
          <IconButton
            icon={Plus}
            label="Add piece"
            variant="bare"
            onPress={() => setAddSheetVisible(true)}
          />
        }
      />

      {/*
        The only thing on this screen that can fail without a screen of its
        own. A tile's action is two words and has nowhere to put a sentence.
      */}
      {actionError ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.actionError}>
          {actionError}
        </Text>
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
        onOpenPiece={(piece) => {
          // One tap earlier than the screen that needs it, so the history
          // card is usually there on the first frame instead of dropping in
          // afterwards. See `prefetchPieceHistory`.
          prefetchPieceHistory(queryClient, piece.id);
          navigation.navigate('PieceDetail', { pieceId: piece.id });
        }}
        busyPieceId={busyPieceId}
        insightByPiece={insightByPiece}
        onReadAgain={(piece) => {
          setActionError(null);
          readAgain.mutate(piece.id, {
            onError: (cause) => setActionError(describe(cause)),
          });
        }}
        onDiscard={(piece) => {
          setActionError(null);
          setDiscarding(piece);
        }}
      />

      <AddPieceSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        onSelect={handleSelectOption}
      />

      {/*
        Asked, even though nothing was read from the page: the photograph is
        the musician's and this throws it away. `PieceDetailScreen` asks before
        the same deletion, and a shelf that did it on one tap would be the one
        destructive action in the app that does not.
      */}
      <ConfirmDialog
        visible={discarding !== null}
        title="Discard this scan?"
        message={
          discarding
            ? `${discarding.title} and the photograph of it will be permanently deleted. Nothing was read from the page.`
            : ''
        }
        confirmLabel="Discard"
        onConfirm={() => {
          const piece = discarding;
          setDiscarding(null);
          if (piece) {
            discard.mutate(piece.id, {
              onError: (cause) => setActionError(describe(cause)),
            });
          }
        }}
        onCancel={() => setDiscarding(null)}
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
  /** Read the page again, for a tile whose scan failed. */
  onReadAgain: (piece: Piece) => void;
  /** Ask before throwing that scan away. */
  onDiscard: (piece: Piece) => void;
  /** The one piece with something running, if any. */
  busyPieceId: string | null;
  insightByPiece: ReadonlyMap<string, PieceInsight>;
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
  onReadAgain,
  onDiscard,
  busyPieceId,
  insightByPiece,
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
      // No action here, and no description: the primary Add piece button sits
      // directly above, so "Add a piece and it will appear here" was telling a
      // musician to do the thing already on screen. The title is the whole of
      // what this state has to say.
      <EmptyState icon={Library} title="No pieces yet" />
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
      /*
        **Rows while searching, tiles while browsing.** A shelf is for
        recognising a piece you would know by sight; a search result is
        something you have already named, and the answer to "Kreutzer" is the
        matches in one list, densest first. The two gestures want different
        shapes, which is why the frame's grid did not simply replace the row.
      */
      <View
        style={styles.section}
        /*
         * **Named because a list of results deserves a name**, and because
         * `walk-app.mjs` needs a scope rather than a caption.
         *
         * The walk used to read "12 pieces found" off this screen to check
         * that searching narrows. That line is gone — it told a musician the
         * length of a list they were looking at — and the walk now counts the
         * rows inside this container instead, which measures the real thing
         * rather than a label claiming it.
         *
         * The scope is the load-bearing part. React Navigation keeps the
         * other tabs mounted, so Today's take row still holds a piece title
         * in the document while this list is filtered to nothing; an
         * unscoped count passed with the filter broken, which is the exact
         * trap `walk-app.mjs` documents above its search checks.
         */
        accessibilityLabel="Search results"
        accessible={false}
      >
        {results.map((piece, index) => (
          <FadeIn key={piece.id} index={index}>
            <PieceRow
              piece={piece}
              divided={rowDivided(index)}
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
          <GroupHeading label={group.label} count={group.pieces.length} />
          {/*
            **A shelf, two across.** The rows identified a piece by its name
            alone, which is correct for an index and wrong for the thing a
            musician is doing here: looking for the piece they would know if
            they saw it. See `PieceTile` — the picture is the engraving, so the
            recognition costs no image fetch and no decode, which is what made
            the old photographic thumbnail untenable.

            An odd count leaves a gap rather than stretching the last tile
            across the row: a shelf with one book on the end still has
            book-shaped books on it.
          */}
          <View style={styles.shelf}>
            {group.pieces.map((piece) => (
              // The stagger runs across the whole screen rather than restarting
              // per group, so the tiles arrive as one sweep instead of four.
              <FadeIn key={piece.id} index={row++} style={styles.slot}>
                <PieceTile
                  piece={piece}
                  insight={insightByPiece.get(piece.id) ?? null}
                  onPress={() => onOpenPiece(piece)}
                  onReadAgain={() => onReadAgain(piece)}
                  onDiscard={() => onDiscard(piece)}
                  busy={busyPieceId === piece.id}
                />
              </FadeIn>
            ))}
            {group.pieces.length % 2 === 1 ? (
              <View style={styles.slot} accessibilityElementsHidden />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * "This week", its count, and a hairline under both
 * (`redesign/Library.dc.html`).
 *
 * **Sentence case in ink, where the app's `SectionHeader` is an uppercase
 * eyebrow.** On a shelf the heading is the only type between rows of pages,
 * and it is read as a date — "Earlier this month" — rather than as a category
 * label. The count is the one number a shelf cannot show at a glance once it
 * runs past the screen.
 */
function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.heading} accessibilityRole="header">
      <Text variant="sectionLabel" color="textPrimary" style={styles.headingLabel}>
        {label}
      </Text>
      <Text
        variant="caption"
        color="textTertiary"
        style={styles.headingCount}
        accessibilityLabel={`${count} ${count === 1 ? 'piece' : 'pieces'}`}
      >
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingBottom: spacing.sm,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  headingLabel: {
    flex: 1,
  },
  headingCount: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  actionError: {
    marginTop: spacing.md,
  },
  section: {
    marginTop: 26,
  },
  group: {
    // The gap between groups is what a heading needs to belong to the rows
    // below it rather than float between two blocks.
    marginBottom: 28,
  },
  shelf: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
    // Row gap larger than column gap: two tiles side by side are one shelf and
    // the rows above and below are different ones, so the vertical rhythm has
    // to be the louder of the two.
    rowGap: 22,
    columnGap: spacing.md,
  },
  slot: {
    // Two across, with the column gap taken out of the pair rather than out of
    // each tile — `flexBasis` of exactly half would overflow by the gap.
    flexBasis: '48%',
    flexGrow: 0,
    minWidth: 0,
  },
});
