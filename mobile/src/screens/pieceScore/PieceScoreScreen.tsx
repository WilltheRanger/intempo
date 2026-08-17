import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Stave } from '../../components/notation/Stave';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import {
  EmptyState,
  LoadingState,
  MetadataRow,
  PageHeader,
  ScreenContainer,
  SegmentedControl,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import { spacing } from '../../design';
import { describeOmissions, staveScoreFor } from '../../lib/notation/fromScore';
import type { Clef } from '../../data/types';
import type { RootStackParamList } from '../../navigation/types';

/** Read from a stand, not glanced at — the same size the warmup page uses. */
const STAVE_SCALE = 1.25;

/**
 * How a clef is named in prose.
 *
 * Spelled out rather than drawn: `engrave.ts` deliberately draws no clef, and a
 * hand-approximated treble clef would be the first thing a musician noticed.
 */
const CLEF_LABELS: Record<Clef, string> = {
  treble: 'Treble clef',
  bass: 'Bass clef',
  alto: 'Alto clef',
  tenor: 'Tenor clef',
};

/** Tall enough that a page of sheet music is legible rather than indicated. */
const PAGE_HEIGHT = 420;

type ScoreView = 'notation' | 'original';

/**
 * A saved piece's own score.
 *
 * **This screen exists because the two rows that led here led somewhere else.**
 * "Digital score" and "Original pages" on the piece screen both pushed routes
 * that read the in-memory *scan session* — so they showed whatever was last
 * photographed, under the name of the piece you had opened, and with no scan in
 * flight they showed "Nothing to review". Worse, the captured-pages screen has
 * a live "Continue" footer, so from any piece in the library you could walk
 * forward into the transcription flow and land on a hardcoded fixture.
 *
 * Both rows now come here, with a piece id, and this reads that piece.
 *
 * The engraving is drawn from the piece's real `score_json`, and it does not
 * round: see `lib/notation/fromScore.ts` for why a stave that misreports
 * rhythm is the one picture this app must never draw, and what it does
 * instead.
 */
export function PieceScoreScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'PieceScore'>>();
  const { data: piece, isPending, isError } = usePiece(params.pieceId);

  const [view, setView] = useState<ScoreView>(params.view ?? 'notation');
  // The engraver needs a pixel width to wrap against, and only layout knows it.
  const [width, setWidth] = useState<number | null>(null);

  const stave = useMemo(
    () => (piece?.score ? staveScoreFor(piece.score) : null),
    [piece?.score],
  );

  function measure(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  if (isPending) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (isError || !piece) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Couldn't open this score"
          description="The piece may have been removed from your library."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const hasNotation = (stave?.notes.length ?? 0) > 0;
  const hasPages = piece.thumbnail !== null;

  // Both halves exist only when the piece was photographed *and* transcribed.
  // A piece entered by hand has neither, and a toggle between two absences
  // would be the emptiest control in the app (§3 law 10).
  const showToggle = hasNotation && hasPages;
  const showing: ScoreView = showToggle ? view : hasNotation ? 'notation' : 'original';

  return (
    <ScreenContainer>
      <PageHeader
        eyebrow={piece.composer}
        title={piece.title}
        onBack={() => navigation.goBack()}
        backLabel="Back to piece"
      />

      {/*
        What a printed part states in its top-left corner, and what the stave
        cannot: nothing here draws a clef, so without this line the same
        notehead is a different pitch to a violist than to a violinist.
      */}
      {showing === 'notation' && hasNotation ? (
        <MetadataRow
          variant="metadataSmall"
          items={[
            CLEF_LABELS[piece.score?.clef ?? 'treble'],
            piece.score?.time_signature && piece.score.time_signature !== 'unknown'
              ? piece.score.time_signature
              : null,
            piece.score?.tempo_marking,
            piece.markedBpm ? `${piece.markedBpm} BPM` : null,
          ]}
          style={styles.scoreMeta}
        />
      ) : null}

      {showToggle ? (
        <SegmentedControl
          label="Score view"
          options={[
            { value: 'notation' as const, label: 'Notation' },
            { value: 'original' as const, label: 'Original' },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}

      {!hasNotation && !hasPages ? (
        <EmptyState
          title="No score to show"
          description="This piece was entered by hand, so there is no transcription and no photograph. Photograph the music to get both."
        />
      ) : null}

      {showing === 'notation' && hasNotation && stave ? (
        <View style={styles.plate} onLayout={measure}>
          {width === null ? null : (
            <Stave
              notes={stave.notes}
              clef={piece.score?.clef ?? 'treble'}
              maxWidth={width}
              scale={STAVE_SCALE}
              justify
              // A letter under every note is a study-book aid. On repertoire it
              // reads as a crib, so the clef is stated as metadata above
              // instead — which is where a clef belongs on a screen for reading
              // music, and is the obligation `showNoteNames={false}` carries.
              showNoteNames={false}
            />
          )}

          {describeOmissions(stave) ? (
            <Text
              variant="metadataSmall"
              color="textTertiary"
              style={styles.caveat}
            >
              {describeOmissions(stave)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {showing === 'original' && hasPages ? (
        <ScoreThumbnail source={piece.thumbnail} style={styles.page} />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scoreMeta: {
    marginTop: spacing.sm,
  },
  plate: {
    marginTop: spacing.xl,
  },
  caveat: {
    marginTop: spacing.lg,
  },
  page: {
    width: '100%',
    height: PAGE_HEIGHT,
    marginTop: spacing.xl,
  },
});
