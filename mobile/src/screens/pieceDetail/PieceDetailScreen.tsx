import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { FileMusic, Layers } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SheetOptionRow } from '../../components/overlays/SheetOptionRow';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import {
  Card,
  EmptyState,
  LoadingState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ProgressBar,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { spacing } from '../../design';
import { formatLastPracticed, formatProgressPercent } from '../../lib/format';
import { scheduleScore, type Schedule } from '../../lib/score';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { ListenButton } from '../record/ListenButton';

/** Height of the score strip across the top of the score card. */
const BANNER_HEIGHT = 88;

/**
 * Which measure is sounding at `elapsedS`.
 *
 * The last note to have started, not the nearest — a playhead names what you
 * are hearing, and between two notes you are still hearing the first. Null
 * before the first note, which is where a lead-in sits.
 */
function measureAt(schedule: Schedule | null, elapsedS: number): number | null {
  if (!schedule) {
    return null;
  }
  let current: number | null = null;
  for (const note of schedule.notes) {
    if (note.startS > elapsedS) {
      break;
    }
    current = note.measureNumber;
  }
  return current;
}

/**
 * A saved piece.
 *
 * **Playback is real.** It used to be a `setTimeout` that advanced a number
 * against `MOCK_MEASURE_COUNT` — a constant 24 — while making no sound, so the
 * screen reported "Measure 1 of 24" for every piece in the library including
 * ones with no notes at all. It now schedules the actual `score_json` through
 * the same engine the warmup and the record screen use, at the tempo the
 * musician last practised this piece at, and the readout follows the playhead.
 *
 * Everything on this screen is conditional on the piece really having the
 * thing it describes: no notes, no transport; no photographs, no "Original
 * pages" row. A piece added by hand has neither, and says so by omission
 * rather than by opening empty screens.
 */
export function PieceDetailScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'PieceDetail'>>();
  const { data: piece, isPending, isError } = usePiece(params.pieceId);

  // Null when nothing is sounding, so the readout can say how long the piece
  // is rather than claiming a playhead sits on measure 1.
  const [measure, setMeasure] = useState<number | null>(null);

  // The tempo this piece was last practised at, which is the tempo it should
  // be heard at — the same value the record screen and Today read.
  usePracticeTempos();
  const bpm = piece ? practiceTempo.for(piece.id, piece.markedBpm) : 0;

  // Deterministic and pure, so building it here costs one pass over the notes
  // and keeps `ListenButton` unaware that anyone is counting measures.
  const schedule = useMemo(
    () =>
      piece?.score && piece.score.measures.length > 0
        ? scheduleScore(piece.score, bpm)
        : null,
    [piece?.score, bpm],
  );

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
          title="Couldn't open this piece"
          description="It may have been removed from your library."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const started = piece.progress !== null && piece.progress > 0;
  const measureCount = piece.score?.measures.length ?? 0;
  const hasNotation = measureCount > 0;
  const hasPages = piece.thumbnail !== null;

  return (
    <ScreenContainer>
      <PageHeader
        title={piece.title}
        onBack={() => navigation.goBack()}
        backLabel="Back to library"
      />

      {piece.composer ? (
        <Text variant="composer" color="textSecondary">
          {piece.composer}
        </Text>
      ) : null}
      {piece.movement ? (
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.movement}
        >
          {piece.movement}
        </Text>
      ) : null}

      <Card emphasis padded={false} style={styles.scoreCard}>
        {/*
          Only when there is a page to show. A hand-entered piece has none, and
          the fallback drawing filled 88pt with a single grey rule — a picture
          of nothing, which is worse than no picture (§3 law 10).
        */}
        {hasPages ? (
          <ScoreThumbnail
            source={piece.thumbnail}
            radius={0}
            style={styles.banner}
          />
        ) : null}

        <View style={styles.scoreBody}>
          {/*
            Progress and last-practised are both null for a piece that has
            never been recorded, and an empty track above an empty line is two
            elements reporting the same absence. The button below says what to
            do about it.
          */}
          {piece.progress !== null ? (
            <ProgressBar
              value={piece.progress}
              accessibilityLabel={`Progress through ${piece.title}`}
            />
          ) : null}
          {piece.progress !== null || piece.lastPracticedAt !== null ? (
            <MetadataRow
              variant="metadataSmall"
              items={[
                formatProgressPercent(piece.progress),
                formatLastPracticed(piece.lastPracticedAt),
              ]}
              style={piece.progress !== null ? styles.scoreMeta : undefined}
            />
          ) : null}

          <PrimaryButton
            label={started ? 'Continue practice' : 'Start practice'}
            onPress={() => navigation.navigate('Record', { pieceId: piece.id })}
            style={
              piece.progress !== null || piece.lastPracticedAt !== null
                ? styles.practice
                : undefined
            }
          />
        </View>
      </Card>

      {/*
        Only for a piece that has notes. A hand-entered piece has none, and a
        transport that can't sound anything is furniture (§3 law 10).
      */}
      {measureCount > 0 ? (
        <Card style={styles.playbackCard}>
          <Text variant="sectionLabel" color="textSecondary">
            Playback
          </Text>

          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.position}
          >
            {measure === null
              ? `${measureCount} ${measureCount === 1 ? 'measure' : 'measures'}`
              : `Measure ${measure} of ${measureCount}`}
          </Text>

          <View style={styles.transport}>
            <ListenButton
              score={piece.score}
              bpm={bpm}
              onProgress={(elapsed, total) =>
                setMeasure(total > 0 ? measureAt(schedule, elapsed) : null)
              }
            />
          </View>
        </Card>
      ) : null}

      {hasNotation || hasPages ? (
        <Card padded={false} style={styles.accessCard}>
          <View style={styles.accessRows}>
            {hasNotation ? (
              <SheetOptionRow
                icon={FileMusic}
                label="Digital score"
                description="The transcribed notation."
                divided={false}
                onPress={() => navigation.navigate('TranscriptionReview')}
              />
            ) : null}
            {/*
              Absent for a piece typed in by hand: there are no photos it was
              transcribed from, because it never was. A row promising them
              would open an empty screen.
            */}
            {hasPages ? (
              <SheetOptionRow
                icon={Layers}
                label="Original pages"
                description="The photos this piece was transcribed from."
                divided={hasNotation}
                onPress={() => navigation.navigate('CapturedPages')}
              />
            ) : null}
          </View>
        </Card>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  movement: {
    marginTop: spacing.xs,
  },
  scoreCard: {
    marginTop: spacing.xl,
  },
  banner: {
    width: '100%',
    height: BANNER_HEIGHT,
  },
  scoreBody: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  scoreMeta: {
    marginTop: spacing.sm,
  },
  practice: {
    marginTop: spacing.lg,
  },
  playbackCard: {
    marginTop: spacing.md,
  },
  position: {
    marginTop: spacing.md,
  },
  transport: {
    marginTop: spacing.md,
  },
  accessCard: {
    marginTop: spacing.md,
  },
  accessRows: {
    paddingHorizontal: spacing.lg,
  },
});
