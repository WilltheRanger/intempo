import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
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
import { useTranscribePage } from '../../data/hooks/useScan';
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
  const pages = useCapturedPages();
  const transcribe = useTranscribePage();

  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [movement, setMovement] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const imageUrl = captureSession.uploadedImageUrl();

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Give the piece a title — it is how you will find it again.');
      return;
    }
    if (!imageUrl) {
      setError(
        'The uploaded page has expired. Go back and send it again.',
      );
      return;
    }

    setError(null);
    try {
      const piece = await transcribe.mutateAsync({
        imageUrl,
        title: trimmed,
        composer: composer.trim() || null,
        movement: movement.trim() || null,
      });
      // The scan is finished with; leaving it in place would let a later save
      // reuse an expired upload URL.
      captureSession.reset();
      // Unwind the finished flow, then open the piece.
      //
      // `replace` was wrong first: it swaps out only this screen and leaves the
      // scanner and the page list underneath, so Back from the piece you just
      // saved walked *into* the scan flow you had finished, whose session had
      // been cleared a line earlier.
      //
      // `reset({routes: [{name: 'Tabs'}, …]})` fixed that and broke something
      // quieter: it rebuilds the whole stack, so the `Tabs` entry it writes is
      // a *fresh* one and the tab navigator falls back to its initial tab.
      // Someone who opened the scanner from the Library was returned to Today,
      // having lost the tab they were on for no reason they could see.
      //
      // `popTo('Tabs')` then `navigate` looked like the answer and wasn't: two
      // dispatches, the second from a screen the first had already unmounted,
      // and the tab still came back as Today.
      //
      // So: one dispatch, and carry the existing `Tabs` route object across
      // rather than writing a fresh `{ name: 'Tabs' }`. The nested tab state
      // travels with it, which is the whole point — `{ name: 'Tabs' }` is a
      // *new* Tabs with no state, and a navigator with no state falls back to
      // its initial route.
      const tabs = navigation
        .getState()
        ?.routes.find((route) => route.name === 'Tabs')?.state;
      const activeTab = tabs?.routes[tabs.index ?? 0]?.name;
      navigation.reset({
        index: 1,
        routes: [
          {
            name: 'Tabs',
            // Naming the tab is what preserves it. The live nested state can't
            // be passed straight through — `reset` takes a *partial* state and
            // that one is a settled one — and it doesn't need to be: every tab
            // here is a leaf screen, so which tab is the whole of it.
            // Undefined on a cold start, which is honestly "no tab chosen yet".
            state: activeTab ? { index: 0, routes: [{ name: activeTab }] } : undefined,
          },
          { name: 'PieceDetail', params: { pieceId: piece.id } },
        ],
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
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
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <PageHeader
        title="Name this piece"
        onBack={() => navigation.goBack()}
        backLabel="Back to pages"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        Reading the notation takes about ten seconds once you save.
      </Text>

      <Input
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="Sonata No. 1 in G minor"
        serif
        autoCapitalize="words"
        style={styles.first}
      />
      <Input
        label="Composer"
        value={composer}
        onChangeText={setComposer}
        placeholder="Optional"
        autoCapitalize="words"
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

      {/*
        The page stays visible while they type, because the title is usually
        printed on it. Paging through is kept for the same reason — the title
        can be on a different sheet from the one that opens the scan — even
        though only the first page is transcribed.
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

      {pages.length > 1 ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
          Only the first page is transcribed. A score spanning several pages
          isn&apos;t supported yet.
        </Text>
      ) : null}

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label="Save piece"
        onPress={() => void save()}
        loading={transcribe.isPending}
        disabled={transcribe.isPending}
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
  caveat: {
    marginTop: spacing.md,
  },
  error: {
    marginTop: spacing.lg,
  },
  save: {
    marginTop: spacing['2xl'],
  },
});
