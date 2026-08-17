import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import {
  FileMusic,
  Layers,
  MoreVertical,
  PencilLine,
  Trash2,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '../../components/overlays/BottomSheet';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import { SheetOptionRow } from '../../components/overlays/SheetOptionRow';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import {
  Card,
  EmptyState,
  IconButton,
  Input,
  LoadingState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ProgressBar,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import {
  useDeletePiece,
  usePiece,
  useUpdatePiece,
} from '../../data/hooks/usePieces';
import type { Piece } from '../../data/types';
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

  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComposer, setDraftComposer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const updatePiece = useUpdatePiece(params.pieceId);
  const deletePiece = useDeletePiece();

  function startEditing(current: Piece) {
    setError(null);
    setDraftTitle(current.title);
    setDraftComposer(current.composer ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    const title = draftTitle.trim();
    if (!title) {
      setError('A piece needs a title.');
      return;
    }
    setError(null);
    try {
      await updatePiece.mutateAsync({
        title,
        composer: draftComposer.trim() || null,
      });
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that.");
    }
  }

  async function confirmDelete() {
    setConfirmingDelete(false);
    try {
      await deletePiece.mutateAsync(params.pieceId);
      // The piece this screen is about no longer exists, so there is nothing
      // to return to it for.
      navigation.goBack();
    } catch (cause) {
      // Nearly always the "this piece has takes" rule, which is a fact about
      // the musician's history rather than a failure — so it stays on screen
      // instead of vanishing with the dialog.
      setError(
        cause instanceof Error ? cause.message : "Couldn't delete that piece.",
      );
    }
  }

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
        action={
          <IconButton
            icon={MoreVertical}
            label="Piece options"
            onPress={() => setMenuVisible(true)}
          />
        }
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

      {/*
        Correcting the name in place, the same shape `TranscriptionReviewScreen`
        uses for the same job — a typed-in title will have typos in it, and
        until now there was no way to fix one.
      */}
      {editing ? (
        <Card style={styles.editCard}>
          <Input
            label="Title"
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="Composition title"
            serif
            autoCapitalize="words"
          />
          <Input
            label="Composer"
            value={draftComposer}
            onChangeText={setDraftComposer}
            placeholder="Optional"
            autoCapitalize="words"
            style={styles.editField}
          />
          <View style={styles.editActions}>
            <SecondaryButton label="Cancel" onPress={() => setEditing(false)} />
            <PrimaryButton
              label="Save"
              onPress={() => void saveEdit()}
              loading={updatePiece.isPending}
              disabled={updatePiece.isPending}
            />
          </View>
        </Card>
      ) : null}

      {/*
        Sits under the title because that is what it is usually about — a
        rename that failed, or the refusal to delete a piece with takes behind
        it. Not inside the dialog: the dialog is gone by the time the answer
        arrives.
      */}
      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
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

      <BottomSheet
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        title={piece.title}
      >
        <SheetOptionRow
          icon={PencilLine}
          label="Rename"
          description="Correct the title or composer."
          divided={false}
          onPress={() => {
            setMenuVisible(false);
            startEditing(piece);
          }}
        />
        <SheetOptionRow
          icon={Trash2}
          label="Remove from library"
          description={
            piece.lastPracticedAt
              ? 'Only possible before a piece has been recorded.'
              : 'This piece has no recordings, so it can be removed.'
          }
          onPress={() => {
            setMenuVisible(false);
            setError(null);
            setConfirmingDelete(true);
          }}
        />
      </BottomSheet>

      <ConfirmDialog
        visible={confirmingDelete}
        title="Remove this piece?"
        // Accurate whichever way this goes. The old line — "nothing you have
        // recorded is deleted" — was true of a successful removal and
        // bewildering in front of the refusal, which is exactly the case a
        // piece with recordings is heading for.
        message={`${piece.title} goes out of your library. This cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  movement: {
    marginTop: spacing.xs,
  },
  editCard: {
    marginTop: spacing.lg,
  },
  editField: {
    marginTop: spacing.lg,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  error: {
    marginTop: spacing.md,
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
