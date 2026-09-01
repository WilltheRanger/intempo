import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useGoBack } from '../../navigation/useGoBack';
import { ComposerField } from '../../components/pieces/ComposerField';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import {
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import { useAttachScorePages, useTranscribePage } from '../../data/hooks/useScan';
import { spacing } from '../../design';
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
        { name: 'PieceScore', params: { pieceId } },
      ],
    });
  }

  async function save() {
    if (imageKeys.length !== pages.length) {
      setError(
        'The uploaded pages are incomplete. Go back and send them again.',
      );
      return;
    }

    const trimmed = title.trim();
    if (!attachmentPieceId && !trimmed) {
      setError('Give the piece a title — it is how you will find it again.');
      return;
    }

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
    }
  }

  if (pages.length === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Nothing to review"
          description="Capture a page of sheet music first."
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <PageHeader
        eyebrow="Step 2 of 3"
        title={attachmentPieceId ? 'Attach sheet music' : 'Name this piece'}
        onBack={goBack}
        backLabel="Back to pages"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        {attachmentPieceId
          ? 'Check the page order. InTempo will read these into the piece already in your library.'
          : 'Name the piece now. After you save it, InTempo reads every page in order and opens the notation for you to check.'}
      </Text>

      {!attachmentPieceId ? (
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
            placeholder="I. Adagio — optional"
            autoCapitalize="words"
            style={styles.field}
          />
        </>
      ) : null}

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
            onPress={() => setPageIndex((index) => index - 1)}
            disabled={pageIndex === 0}
          />
          <Text variant="sectionLabel" color="textSecondary">
            Page {pageIndex + 1} of {pages.length}
          </Text>
          <IconButton
            icon={ChevronRight}
            label="Next page"
            onPress={() => setPageIndex((index) => index + 1)}
            disabled={pageIndex >= pages.length - 1}
          />
        </View>
      ) : null}

      <ScoreThumbnail
        source={pages[pageIndex]?.source ?? null}
        style={styles.page}
      />

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {/*
        No longer the ten-to-sixty-second wait it used to be. The request now
        creates the row and returns; reading the page happens in a worker and
        is watched on the score screen this lands on.
      */}
      <PrimaryButton
        label={
          attachmentPieceId
            ? pages.length === 1
              ? 'Attach and read page'
              : `Attach and read ${pages.length} pages`
            : pages.length === 1
              ? 'Save and read page'
              : `Save and read ${pages.length} pages`
        }
        onPress={() => void save()}
        loading={attachmentPieceId ? attach.isPending : transcribe.isPending}
        disabled={attachmentPieceId ? attach.isPending : transcribe.isPending}
        style={styles.save}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.xs,
  },
  first: {
    marginTop: spacing.xl,
  },
  field: {
    marginTop: spacing.lg,
  },
  pageNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  page: {
    width: '100%',
    height: PAGE_HEIGHT,
    marginTop: spacing.xl,
  },
  error: {
    marginTop: spacing.lg,
  },
  save: {
    marginTop: spacing['2xl'],
  },
});
