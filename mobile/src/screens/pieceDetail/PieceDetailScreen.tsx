import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import {
  Camera,
  FileMusic,
  Images,
  Layers,
  MoreVertical,
  PencilLine,
  Trash2,
} from '../../components/icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';
import { ComposerField } from '../../components/pieces/ComposerField';

import { BottomSheet } from '../../components/overlays/BottomSheet';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import { SheetOptionRow } from '../../components/overlays/SheetOptionRow';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { ScoreBand } from '../../components/score/ScoreBand';
import {
  Card,
  EmptyState,
  IconButton,
  Input,
  LoadingState,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  SCREEN_GUTTER,
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
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { formatLastPracticed } from '../../lib/format';
import { formatTempo } from '../../lib/tempo';
import { scheduleScore, soundingMeasureAt } from '../../lib/score';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { ListenButton } from '../../components/score/ListenButton';
import { loadStateFor } from '../../lib/loadState';

/**
 * How tall the score band across the top of the screen is.
 *
 * Enough to read as a page and not enough to argue with the title. It used to
 * be 88 inside a bordered card; it is taller now because it is doing more work
 * — see the band itself.
 */
const BANNER_HEIGHT = 116;

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
  const goBack = useGoBack({ tab: 'Library' });
  const { params } = useRoute<RouteProp<RootStackParamList, 'PieceDetail'>>();
  const { data: piece, isError } = usePiece(params.pieceId);
  const load = loadStateFor({ isError, hasData: piece !== undefined });

  // Null when nothing is sounding, so the readout can say how long the piece
  // is rather than claiming a playhead sits on measure 1.
  const [measure, setMeasure] = useState<number | null>(null);

  const [menuVisible, setMenuVisible] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComposer, setDraftComposer] = useState('');
  const [draftMovement, setDraftMovement] = useState('');
  const [error, setError] = useState<string | null>(null);

  const updatePiece = useUpdatePiece(params.pieceId);
  const deletePiece = useDeletePiece();

  function startEditing(current: Piece) {
    setError(null);
    setDraftTitle(current.title);
    setDraftComposer(current.composer ?? '');
    setDraftMovement(current.movement ?? '');
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
        movement: draftMovement.trim() || null,
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
      goBack();
    } catch (cause) {
      // The backend makes each cleanup step safe to repeat. Keep the failure
      // visible on the piece so the musician can retry the same action.
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

  if (load === 'loading') {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (load === 'unavailable' || !piece) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title="Couldn't open this piece"
          description="It may have been removed from your library."
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  /**
   * Whether this piece has been recorded before.
   *
   * One fact, answering two questions: whether the button says "Continue" and
   * whether there is any history to show. It used to be two — `started` read
   * `progress > 0`, a field with no backing column that `sources/api.ts` maps
   * to null, so against the live API every piece said "Start practice" forever,
   * including one recorded fifty times.
   */
  const played = piece.lastPracticedAt !== null;
  const measureCount = piece.score?.measures.length ?? 0;
  const hasNotation = measureCount > 0;
  const hasPages = piece.thumbnail !== null;
  // A scan still in flight. The piece is real and openable already — that is
  // the whole point of writing the row first — but it has no notes yet, so
  // every row here that promises notation would open an empty screen.
  const stillReading =
    piece.transcriptionStatus === 'queued' || piece.transcriptionStatus === 'reading';
  const readingFailed = piece.transcriptionStatus === 'failed';
  const canPractice = hasNotation && !stillReading && !readingFailed;
  const needsNotation = !hasNotation && !hasPages && !stillReading;

  return (
    /*
      **The action is the footer, not a row in the middle of the page.**
      "Continue practice" is the one thing this screen is for, and §3 law 7 puts
      the primary action where a thumb reaches. It used to sit at about a third
      of the way down, inside a card, level with the score band — so the screen
      opened with two things competing to be looked at first.
    */
    <ScreenContainer
      footer={
        canPractice ? (
          <PrimaryButton
            label={played ? 'Continue practice' : 'Start practice'}
            onPress={() => navigation.navigate('Record', { pieceId: piece.id })}
          />
        ) : undefined
      }
    >
      {/*
        **The composer sits above the title, as it does everywhere else.**
        This screen used to put it underneath, in its own `Text` block, while
        `PieceScoreScreen` and `RecordScreen` both pass it as the eyebrow — so
        opening a piece and then its score flipped the composer from under the
        title to over it, on the same piece. `PageHeader` always draws the
        eyebrow above (there is no option to invert it), so the majority wins
        and this screen joins them.

        The movement went with it, into the facts row below the score band:
        it is a fact about the piece like the tempo and the measure count, and
        it was the second of two stray lines between the header and the image.
      */}
      <PageHeader
        eyebrow={piece.composer}
        title={piece.title}
        onBack={goBack}
        backLabel="Back to library"
        action={
          <IconButton
            icon={MoreVertical}
            label="Piece options"
            onPress={() => setMenuVisible(true)}
          />
        }
      />

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
          {/* Correcting a name afterwards is exactly when a musician reaches
              for the spelling the rest of their library uses. */}
          <ComposerField
            value={draftComposer}
            onChangeText={setDraftComposer}
            style={styles.editField}
          />
          <Input
            label="Movement"
            value={draftMovement}
            onChangeText={setDraftMovement}
            placeholder="I. Adagio — optional"
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

      {/*
        **A band, not a thumbnail in a box.** Sheet music is this app's visual
        identity, and the opening of the piece is the truest picture of it there
        is. Inside a bordered card it read as an attachment to the piece; edge
        to edge under the title it reads as the piece. The gutter is cancelled
        rather than the screen re-laid out, which is what `SCREEN_GUTTER` is
        exported for.

        **The digitised page, not the photograph of it.** This was a crop of
        what the camera saw — a phone photograph of paper, signed out of a
        private bucket — and what it showed was a desk, a shadow and whatever
        the lighting did, which is a picture of the photography rather than of
        the music. The reading draws, and what it draws is the same music
        printed rather than photographed. It is also the version everything
        downstream is measured against, so a glance at it is a glance at what
        the app will judge the take by.

        The photograph is still one tap away and still every page of it: the
        score screen's Original view, which is the place to go when the
        question is "did it read this right".
      */}
      {hasNotation && piece.score ? (
        <View style={styles.engravedBand}>
          <ScoreBand score={piece.score} />
        </View>
      ) : hasPages ? (
        // Nothing has been read yet — a scan still in the worker, or a reading
        // that failed. The photograph is what the app has of this piece, so it
        // is what the band shows rather than a blank.
        <ScoreThumbnail
          source={piece.thumbnail}
          composer={piece.composer}
          radius={0}
          style={styles.band}
        />
      ) : null}

      {/*
        **One line of facts, in place of two cards.** When you last played it,
        how long it is, and the tempo it will be heard at — typography doing
        what a box was doing (§3 law 8). The middle item becomes the playhead
        while something is sounding, so the line changes in one place instead of
        being replaced.
      */}
      <MetadataRow
        style={styles.facts}
        items={[
          // First, because it names *which* piece this is — a movement is
          // closer to the title than to the tempo. It had its own line under
          // the header until 2026-09-14; `MetadataRow` drops a null, so a piece
          // without one reads exactly as it did.
          piece.movement,
          played ? formatLastPracticed(piece.lastPracticedAt) : null,
          measureCount === 0
            ? null
            : measure === null
              ? `${measureCount} ${measureCount === 1 ? 'measure' : 'measures'}`
              : `Measure ${measure} of ${measureCount}`,
          // **In the page's own unit.** `bpm` is quarter-note BPM, which is the
          // clock the score and the analysis run on and not always the number
          // printed on the music: a 6/8 piece marked dotted-quarter = 60 is 90
          // here. Saying "90 BPM" beside a Record screen that says 60 is two
          // numbers for one tempo.
          hasNotation ? formatTempo(bpm, piece.score?.tempo_beat_unit) : null,
        ]}
      />

      {stillReading ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.facts}>
          Reading the sheet music before practice can begin.
        </Text>
      ) : null}

      {/*
        Hearing the piece belongs with the piece, not with the decision to
        practise — so it stays in the flow while the footer holds the one
        action. Choosing a tempo and a starting bar lives on the score screen,
        where you can see the bars you would be choosing between.
      */}
      {measureCount > 0 ? (
        <View style={styles.listen}>
          <ListenButton
            score={piece.score}
            bpm={bpm}
            onProgress={(elapsed, total) =>
              setMeasure(total > 0 ? soundingMeasureAt(schedule, elapsed) : null)
            }
          />
        </View>
      ) : null}

      {needsNotation ? (
        <Card style={styles.notationCard}>
          <Text variant="sectionLabel" color="textSecondary">
            Add sheet music before recording
          </Text>
          <Text
            variant="body"
            color="textSecondary"
            style={styles.notationCopy}
          >
            InTempo needs the written notes and rests to follow your playing,
            count long rests, and explain where the tempo changed.
          </Text>
          <PrimaryButton
            label="Photograph sheet music"
            icon={Camera}
            onPress={() =>
              navigation.navigate('Scanner', { attachToPieceId: piece.id })
            }
            style={styles.notationPrimary}
          />
          <SecondaryButton
            label="Choose existing images"
            icon={Images}
            onPress={() =>
              navigation.navigate('AddPiece', {
                option: 'import',
                attachToPieceId: piece.id,
              })
            }
            style={styles.notationSecondary}
          />
        </Card>
      ) : null}

      {/*
        **Ruled rows on the page, not a card.** Two destinations with a label
        and a line each — the library's own `PieceRow` separates forty of these
        with a hairline apiece, and a box around two of them groups nothing that
        the rule between them does not already say (§3 law 3).
      */}
      {hasNotation || hasPages || stillReading || readingFailed ? (
        <View style={styles.accessRows}>
            {/*
              A scan in flight, or one that failed, needs a way back to the
              screen that says so. Without this the only route to it was the
              one time the app navigated there itself, right after saving — so
              backing out of a page being read meant losing sight of it, on a
              piece that gives no other sign anything is happening.
            */}
            {stillReading || readingFailed ? (
              <SheetOptionRow
                icon={FileMusic}
                label={stillReading ? 'Reading this page' : "This page couldn't be read"}
                description={
                  stillReading
                    ? piece.transcriptionStage ?? 'Transcribing the notation.'
                    : // **Deliberately not `piece.transcriptionError`**, unlike
                      // the branch above and unlike `PieceScoreScreen`, which
                      // does print the server's reason. Owner's call,
                      // 2026-09-04 — `DECISIONS.md`. The cost is stated there:
                      // a fault on our side reads here as something to fix
                      // with the camera. Do not "fix" this in passing.
                      'Photograph it again to try once more.'
                }
                divided={false}
                onPress={() =>
                  navigation.navigate('PieceScore', { pieceId: piece.id })
                }
              />
            ) : null}
            {/*
              Both rows carry this piece's id. They used to push routes that
              read the shared *scan session* instead, so every piece in the
              library opened whatever was last photographed — and, because the
              captured-pages screen has a live "Continue" footer, you could
              walk from any piece into the transcription flow and save a
              hardcoded fixture over it.
            */}
            {hasNotation && !stillReading && !readingFailed ? (
              <SheetOptionRow
                icon={FileMusic}
                label="Digital score"
                description="The notes read from the page."
                divided={false}
                onPress={() =>
                  navigation.navigate('PieceScore', {
                    pieceId: piece.id,
                    view: 'notation',
                  })
                }
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
                description="The pages this piece was read from."
                divided={hasNotation || stillReading || readingFailed}
                onPress={() =>
                  navigation.navigate('PieceScore', {
                    pieceId: piece.id,
                    view: 'original',
                  })
                }
              />
          ) : null}
        </View>
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
              ? 'Also removes its practice history and recordings.'
              : 'Permanently removes this piece from your library.'
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
        title="Delete this piece?"
        message={
          piece.lastPracticedAt
            ? `${piece.title}, its practice history, and its recordings will be permanently deleted.`
            : `${piece.title} will be permanently deleted from your library.`
        }
        confirmLabel="Delete piece"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  /**
   * The score band, edge to edge.
   *
   * The negative margin cancels `ScreenContainer`'s gutter exactly, so this is
   * the only thing on the screen that reaches the edges — which is the point:
   * it is a picture, and everything else is set in a column.
   */
  band: {
    marginTop: spacing.xl,
    marginHorizontal: -SCREEN_GUTTER,
    width: undefined,
    alignSelf: 'stretch',
    height: BANNER_HEIGHT,
    // Both edges. One was enough to stop the band dissolving downward into the
    // page and left its top edge floating, which reads as a crop that failed
    // rather than as a band.
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  /**
   * The engraved band takes its height from the music rather than from a
   * constant.
   *
   * A photograph is a rectangle and `BANNER_HEIGHT` crops it to one; a system
   * is as tall as its notes reach, and forcing it into a fixed band would
   * either clip a ledger line or leave a strip of empty paper under a sparse
   * one. The top rule is here because `ScoreBand` draws the paper and the
   * bottom rule and cannot know it is against a gutter.
   */
  engravedBand: {
    marginTop: spacing.xl,
    marginHorizontal: -SCREEN_GUTTER,
    alignSelf: 'stretch',
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  facts: {
    marginTop: spacing.lg,
  },
  listen: {
    marginTop: spacing.lg,
  },
  notationCard: {
    marginTop: spacing.xl,
  },
  notationCopy: {
    marginTop: spacing.md,
  },
  notationPrimary: {
    marginTop: spacing.lg,
  },
  notationSecondary: {
    marginTop: spacing.md,
  },
  accessRows: {
    marginTop: spacing['2xl'],
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
});
