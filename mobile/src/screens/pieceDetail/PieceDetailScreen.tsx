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
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ComposerField } from '../../components/pieces/ComposerField';

import { BottomSheet } from '../../components/overlays/BottomSheet';
import { ConfirmDialog } from '../../components/overlays/ConfirmDialog';
import { SheetOptionRow } from '../../components/overlays/SheetOptionRow';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { ScoreBand } from '../../components/score/ScoreBand';
import { PieceLinkRow } from './PieceLinkRow';
import { PracticeHistory } from './PracticeHistory';
import { usePieceHistory } from '../../data/hooks/useLatestTake';
import {
  BackLink,
  Card,
  EmptyState,
  IconButton,
  Input,
  LoadingState,
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
import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { loadStateFor } from '../../lib/loadState';

/**
 * How tall the score band across the top of the screen is.
 *
 * Enough to read as a page and not enough to argue with the title. It used to
 * be 88 inside a bordered card; it is taller now because it is doing more work
 * — see the band itself.
 */
const BANNER_HEIGHT = 116;

/** Room for the opening two systems of the piece, as the prototype draws. */
const OPENING_HEIGHT = 150;

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
  /**
   * "Back to library" goes to the Library, whatever is under this screen.
   *
   * It was `goBack`, which goes to *whatever is under this screen* — and a
   * piece is opened from its score, its takes and its verdicts as well as from
   * the shelf. With any of those beneath it, "Back to library" went back to
   * that screen, whose own "Back to the piece" came here again: the owner
   * found the loop between a piece, its score and Practice (2026-09-23).
   * `popTo` unwinds to the tabs and shows the Library, or replaces this screen
   * with them when it is the only one (a reload on the web).
   */
  const goBack = () => navigation.popTo('Tabs', { screen: 'Library' } as never);
  const { params } = useRoute<RouteProp<RootStackParamList, 'PieceDetail'>>();
  const { data: piece, isError } = usePiece(params.pieceId);
  // **Not part of `load`.** A piece whose history fails to arrive is still a
  // piece worth opening, and blocking the whole screen on it would trade a
  // card for the music.
  const history = usePieceHistory(params.pieceId);
  const load = loadStateFor({ isError, hasData: piece !== undefined });

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
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

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
      "Practice" is the one thing this screen is for, and §3 law 7 puts
      the primary action where a thumb reaches. It used to sit at about a third
      of the way down, inside a card, level with the score band — so the screen
      opened with two things competing to be looked at first.
    */
    <ScreenContainer
      footer={
        canPractice ? (
          <PrimaryButton
            label="Practice"
            onPress={() => navigation.navigate('Record', { pieceId: piece.id })}
          />
        ) : undefined
      }
    >
      {/*
        The redesign's head (`redesign/PieceDetail.dc.html`): a way back in
        words, the title, and the piece's options as a bare glyph beside it.
        The composer is no longer written here — the piece is recognised by
        its title and by the music under it, and the composer is one tap away
        under Rename.
      */}
      <View style={styles.head}>
        <BackLink label="Back to library" onPress={goBack} />
        <View style={styles.titleRow}>
          <Text variant="heroTitle" accessibilityRole="header" style={styles.title}>
            {piece.title}
          </Text>
          <IconButton
            icon={MoreVertical}
            label="Piece options"
            variant="bare"
            onPress={() => setMenuVisible(true)}
            style={styles.options}
          />
        </View>
      </View>

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
            placeholder="I. Adagio (optional)"
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
          {/* The opening two systems, where the prototype draws two lines. */}
          <ScoreBand score={piece.score} viewport={OPENING_HEIGHT} />
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
        **Nothing under the piece.** This carried the movement, when it was
        last practised, and — while Listen was sounding — which measure had
        been reached. Removed whole: on a screen whose subject is one piece,
        the header already names it and everything below is about practising
        it, so a line of facts between the two was a caption on a thing the
        reader is looking at.

        The live "Measure 12 of 24" went with it, which is the part worth
        knowing: Listen no longer reports where it has got to. That readout
        belongs with the control that starts it rather than in a facts line,
        if it comes back at all.
      */}

      {/*
        No Listen here any more: the redesign puts it on the Record screen's
        panel, beside the tempo it plays at and the bar it starts from, which is
        where a musician deciding how to play the piece reaches for it.
      */}

      {/*
        **What happened last time, and how it has gone.** This screen knew
        nothing about the piece's own past — Today answers that across the
        library, Insights across thirty days, and the screen a musician opens
        *because* they are about to play this piece answered neither about it.
        See `PracticeHistory`, which draws nothing at all for a piece nobody
        has recorded.
      */}
      {history.data ? <PracticeHistory history={history.data} /> : null}

      {needsNotation ? (
        <Card style={styles.notationCard}>
          <Text variant="sectionLabel" color="textSecondary">
            Add the sheet music to record
          </Text>
          <PrimaryButton
            label="Photograph it"
            icon={Camera}
            onPress={() =>
              navigation.navigate('Scanner', { attachToPieceId: piece.id })
            }
            style={styles.notationPrimary}
          />
          <SecondaryButton
            label="Choose photos"
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
        **Ruled rows on the page, not a card**, each a glyph, a name and one
        line about what is behind it (`redesign/PieceDetail.dc.html`). Rename is
        one of them now rather than a line in the options sheet: it is the
        thing done to a piece most often after a scan, and it was two taps deep.
      */}
      <View style={styles.accessRows}>
        {/*
          A scan in flight, or one that failed, needs a way back to the screen
          that says so. Without this the only route to it was the one time the
          app navigated there itself, right after saving.
        */}
        {stillReading || readingFailed ? (
          <PieceLinkRow
            icon={FileMusic}
            label={stillReading ? 'Reading the page' : "Couldn't read the page"}
            description={
              stillReading
                ? piece.transcriptionStage ?? null
                : // **Deliberately not `piece.transcriptionError`**, unlike
                  // `PieceScoreScreen`, which does print the server's reason.
                  // Owner's call, 2026-09-04 — `DECISIONS.md`. Do not "fix"
                  // this in passing.
                  'Photograph it again'
            }
            onPress={() => navigation.navigate('PieceScore', { pieceId: piece.id })}
          />
        ) : null}
        {/*
          Both rows carry this piece's id. They used to push routes that read
          the shared *scan session* instead, so every piece in the library
          opened whatever was last photographed.
        */}
        {hasNotation && !stillReading && !readingFailed ? (
          <PieceLinkRow
            icon={FileMusic}
            label="Digital score"
            onPress={() =>
              navigation.navigate('PieceScore', { pieceId: piece.id, view: 'notation' })
            }
          />
        ) : null}
        {/*
          Absent for a piece typed in by hand: there are no photos it was
          transcribed from, and a row promising them would open an empty
          screen.
        */}
        {hasPages ? (
          <PieceLinkRow
            icon={Layers}
            label="Original pages"
            onPress={() =>
              navigation.navigate('PieceScore', { pieceId: piece.id, view: 'original' })
            }
          />
        ) : null}
        <PieceLinkRow
          icon={PencilLine}
          label="Rename"
          onPress={() => startEditing(piece)}
        />
      </View>

      <BottomSheet
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        title={piece.title}
      >
        <SheetOptionRow
          icon={Trash2}
          divided={false}
          label="Delete piece"
          description={piece.lastPracticedAt ? 'And all its takes' : undefined}
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
            ? `${piece.title} and all its takes will be deleted.`
            : `${piece.title} will be deleted.`
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

  listen: {
    marginTop: spacing.lg,
  },
  notationCard: {
    marginTop: spacing.xl,
  },

  notationPrimary: {
    marginTop: spacing.lg,
  },
  notationSecondary: {
    marginTop: spacing.md,
  },
  accessRows: {
    marginTop: 14,
  },
  head: {
    paddingTop: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 26,
    lineHeight: 31,
  },
  // A 44pt target whatever the title does. Not pulled out to the gutter line
  // as the prototype draws it: this screen's column clips at the gutter on
  // the web, and a pulled glyph lost ten points of its target to the clip.
  options: {
    flexShrink: 0,
  },
});
