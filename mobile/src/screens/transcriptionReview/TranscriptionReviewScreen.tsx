import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from '../../components/icons';
import { useGoBack } from '../../navigation/useGoBack';
import { ComposerField } from '../../components/pieces/ComposerField';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import {
  BackLink,
  EmptyState,
  IconButton,
  Input,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import { useAttachScorePages, useTranscribePage } from '../../data/hooks/useScan';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/** Tall enough to read a title and a composer off the photograph. */
const PAGE_HEIGHT = 300;

/**
 * Naming the piece, and saving it.
 *
 * **This is where the score is created, and where OCR actually runs.** The
 * screen it replaced was scaffolding end to end: the "detected" title and
 * composer came from `buildDraft`, a fixture keyed on nothing but the page
 * count; the notation panel drew a structural placeholder; playback moved a
 * marker and made no sound; and "Save piece" navigated to
 * `fixture-wohlfahrt-28` — a hardcoded id, so every scan in the app's history
 * "saved" as the same Wohlfahrt study.
 *
 * **Why naming comes before transcription rather than after.** OCR reads notes.
 * `score_json` has no title field and no composer field, because a phone
 * photograph of an inner page usually shows neither — so there is nothing for a
 * "detected details" step to detect, and the old screen's editable "detected"
 * values were invented. The title is the musician's to give, and
 * `POST /v1/scores` requires it before it will run OCR at all.
 *
 * So: the photograph stays on screen while they type, which is genuinely
 * useful — the title is usually printed on the page they are looking at. The
 * transcription is then checked afterwards, on the piece's own score screen,
 * against a score that really exists.
 */
export function TranscriptionReviewScreen() {
  const navigation = useNavigation<RootNavigation>();
  const goBack = useGoBack({ tab: 'Library' });
  const pages = useCapturedPages();
  const transcribe = useTranscribePage();
  const attachmentPieceId = captureSession.attachmentPieceId();
  const attach = useAttachScorePages(attachmentPieceId ?? '');

  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [movement, setMovement] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  const imageKeys = captureSession.uploadedImageKeys();

  function openReading(pieceId: string) {
    // The scan is finished with; leaving it in place would let a later save
    // reuse the previous scan's object keys or attach to the wrong piece.
    captureSession.reset();
    const tabs = navigation
      .getState()
      ?.routes.find((route) => route.name === 'Tabs')?.state;
    const activeTab = tabs?.routes[tabs.index ?? 0]?.name;
    navigation.reset({
      index: 1,
      routes: [
        {
          name: 'Tabs',
          state: activeTab
            ? { index: 0, routes: [{ name: activeTab }] }
            : undefined,
        },
        // A new piece takes step 3 first — its working tempo — and the score
        // after that; pages attached to a piece already in the library go
        // straight to its score, which already has a tempo.
        attachmentPieceId
          ? { name: 'PieceScore', params: { pieceId } }
          : { name: 'SetTempo', params: { pieceId } },
      ],
    });
  }

  async function save() {
    if (saving.current) return;
    if (pages.length === 0 || imageKeys.length !== pages.length) {
      setError(
        'Some pages didn’t upload. Go back and resend.',
      );
      return;
    }

    const trimmed = title.trim();
    if (!attachmentPieceId && !trimmed) {
      setError('Add a title.');
      return;
    }

    saving.current = true;
    setError(null);
    try {
      const piece = attachmentPieceId
        ? await attach.mutateAsync(imageKeys)
        : await transcribe.mutateAsync({
            imageKeys,
            title: trimmed,
            composer: composer.trim() || null,
            movement: movement.trim() || null,
          });
      openReading(piece.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : attachmentPieceId
            ? 'The sheet music could not be attached. Try again.'
            : 'The score could not be saved. Try again.',
      );
    } finally {
      saving.current = false;
    }
  }

  if (pages.length === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title="Nothing to review"
          description="Capture a page of sheet music first."
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  const saveLabel = attachmentPieceId
    ? pages.length === 1
      ? 'Attach and read page'
      : `Attach and read ${pages.length} pages`
    : pages.length === 1
      ? 'Save and read page'
      : `Save and read ${pages.length} pages`;

  return (
    <ScreenContainer
      footer={
        /*
          No longer the ten-to-sixty-second wait it used to be. The request
          creates the row and returns; reading the page happens in a worker and
          is watched on the score screen.
        */
        <PrimaryButton
          label={saveLabel}
          onPress={() => void save()}
          loading={attachmentPieceId ? attach.isPending : transcribe.isPending}
          disabled={attachmentPieceId ? attach.isPending : transcribe.isPending}
        />
      }
    >
      {/* The redesign's head (`redesign/NamePiece.dc.html`). */}
      <View style={styles.head}>
        <BackLink label="Back to pages" onPress={goBack} />
        <Text variant="screenTitle" accessibilityRole="header">
          {attachmentPieceId ? 'Attach sheet music' : 'Name this piece'}
        </Text>
      </View>

      {/*
        Only when attaching: there is nothing to name, so the screen has to say
        what it is for. Naming a new piece explains itself.
      */}
      {attachmentPieceId ? (
        <Text variant="body" color="textSecondary" style={styles.lede}>
          Check the page order.
        </Text>
      ) : (
        <>
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Sonata No. 1 in G minor"
            serif
            autoCapitalize="words"
            style={styles.first}
          />
          {/* The commonest way a piece enters the library, and it had the
              plainest field of the three. */}
          <ComposerField
            value={composer}
            onChangeText={setComposer}
            style={styles.field}
          />

          <Input
            label="Movement"
            value={movement}
            onChangeText={setMovement}
            placeholder="I. Adagio (optional)"
            autoCapitalize="words"
            style={styles.field}
          />
        </>
      )}

      {/*
        Every page stays available while they type, because title, movement and
        composer can be printed on different sheets. This order is also the
        order the worker reads and joins.
      */}
      {pages.length > 1 ? (
        <View style={styles.pageNav}>
          <IconButton
            icon={ChevronLeft}
            label="Previous page"
            variant="bare"
            onPress={() => setPageIndex((index) => index - 1)}
            disabled={pageIndex === 0}
          />
          <Text variant="metadata" color="textSecondary" style={styles.pageCount}>
            Page {pageIndex + 1} of {pages.length}
          </Text>
          <IconButton
            icon={ChevronRight}
            label="Next page"
            variant="bare"
            onPress={() => setPageIndex((index) => index + 1)}
            disabled={pageIndex >= pages.length - 1}
          />
        </View>
      ) : null}

      {/* The page, on a white card, as the prototype shows it. */}
      <View style={styles.pageCard}>
        <ScoreThumbnail source={pages[pageIndex]?.source ?? null} style={styles.page} />
      </View>

      <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
        Before saving: check that every staff is visible, the pages are in order,
        and the image isn&rsquo;t blurred or covered by shadows.
      </Text>

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingTop: spacing.md,
    marginBottom: spacing.sm,
  },
  lede: {
    marginTop: spacing.md,
  },
  first: {
    marginTop: spacing['2xl'],
  },
  field: {
    marginTop: 18,
  },
  pageNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.xl,
  },
  pageCount: {
    minWidth: 96,
    textAlign: 'center',
  },
  pageCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  page: {
    width: '100%',
    height: PAGE_HEIGHT,
  },
  note: {
    marginTop: spacing.lg,
  },
  error: {
    marginTop: spacing.lg,
  },
});
