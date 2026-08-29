import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
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
import { UploadProgress } from '../../components/score/UploadProgress';
import { ApiError } from '../../data/api/client';
import { UploadError } from '../../data/api/upload';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import { IS_LIVE_BACKEND } from '../../data/environment';
import { useTranscribePage } from '../../data/hooks/useScan';
import { ScanUploadError } from '../../lib/scan/uploadPage';
import { uploadPages, type PageUploadProgress } from '../../lib/scan/uploadPages';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/**
 * Tall enough to read a title and a composer off the photograph, and no taller.
 *
 * It was 300, which made the photograph the largest thing on a screen whose
 * whole purpose is the title field above it — two focal points competing, and
 * the wrong one winning (§3 law 4). It is reference material here, not the
 * subject: the piece is looked at properly on its own score screen.
 */
const PAGE_HEIGHT = 200;

/**
 * Naming the piece — and, underneath, sending the pages.
 *
 * **The upload used to be a screen of its own.** `TranscribeScreen` occupied
 * the whole display saying "Sending your page" with a bar and a Cancel button,
 * and did nothing a musician could act on: they had already chosen their pages
 * and the only thing left was to wait. Then this screen appeared and asked for
 * a title. Two screens, strictly sequential, and the second one needed
 * something from the person that the first one was making them wait for.
 *
 * So the upload runs *here*, from the moment the screen opens, while the title
 * is typed. On any real connection it finishes before anyone has finished
 * typing, and the wait disappears rather than being decorated. Save waits for
 * it if it has not — see `save`.
 *
 * **Why naming still comes before reading.** OCR reads notes. `score_json` has
 * no title field and no composer field, because a phone photograph of an inner
 * page usually shows neither — so there is nothing for a "detected details"
 * step to detect, and the screen this replaced invented its values. The title
 * is the musician's to give, and `POST /v1/scores` requires it. The photograph
 * stays on screen while they type because the title is usually printed on it.
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

  //: Where the upload has got to, or null once every page is up.
  const [progress, setProgress] = useState<PageUploadProgress | null>(null);
  const [uploadFailed, setUploadFailed] = useState<string | null>(null);
  //: Bumped to run the upload again after a failure.
  const [attempt, setAttempt] = useState(0);
  const [sent, setSent] = useState(false);

  /**
   * The upload in flight, so `save` can wait on the same one rather than
   * starting a second.
   *
   * A promise rather than a flag: someone who finishes typing before the pages
   * are up presses Save, and the only correct thing to do is wait for the
   * transfer already running. A flag would make Save either fail or start the
   * upload over.
   */
  const inFlight = useRef<Promise<string[]> | null>(null);

  const unavailable = !IS_LIVE_BACKEND;
  const firstPage = pages[0] ?? null;

  useEffect(() => {
    if (!firstPage || unavailable) {
      return;
    }
    let live = true;
    // Leaving the screen stops the transfer. The flag alone only made the
    // *result* be ignored while the pages kept the phone's whole uplink.
    const abort = new AbortController();

    const run = uploadPages(captureSession.current(), {
      signal: abort.signal,
      onProgress: (at) => {
        if (live) {
          setProgress(at);
        }
      },
    });
    inFlight.current = run;

    void run.then(
      (urls) => {
        if (!live) return;
        captureSession.setUploadedPageUrls(urls);
        setSent(true);
        setProgress(null);
      },
      (cause) => {
        if (!live) return;
        inFlight.current = null;
        setUploadFailed(describeScanFailure(cause));
      },
    );

    return () => {
      live = false;
      abort.abort();
    };
    // Keyed on the scan's identity and the retry counter rather than on the
    // pages array, which is a new object on every notify — depending on it
    // would restart the upload each time a subscriber fired. The pages cannot
    // change while this screen is mounted; the review list is behind it.
  }, [firstPage?.id, pages.length, unavailable, attempt]);

  function retryUpload() {
    setUploadFailed(null);
    setSent(false);
    setProgress(null);
    setAttempt((n) => n + 1);
  }

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Give the piece a title — it is how you will find it again.');
      return;
    }
    setError(null);

    let urls = captureSession.uploadedPageUrls();
    if (urls.length === 0) {
      // Typed faster than the connection. Wait for the transfer that is
      // already running rather than starting another, and let its own failure
      // surface through the same sentence the panel shows.
      const running = inFlight.current;
      if (!running) {
        setError('The pages have not been sent. Try sending them again.');
        return;
      }
      try {
        urls = await running;
        captureSession.setUploadedPageUrls(urls);
      } catch (cause) {
        setUploadFailed(describeScanFailure(cause));
        return;
      }
    }

    try {
      const piece = await transcribe.mutateAsync({
        imageUrls: urls,
        title: trimmed,
        composer: composer.trim() || null,
        movement: movement.trim() || null,
      });
      // The scan is finished with; leaving it in place would let a later save
      // reuse this piece's pages under another piece's title.
      captureSession.reset();
      // Unwind the finished flow, then open the piece.
      //
      // One dispatch, carrying the existing `Tabs` route across rather than
      // writing a fresh `{ name: 'Tabs' }` — a new Tabs has no nested state and
      // a navigator with no state falls back to its initial route, which
      // returned anyone who started from the Library to Today.
      const tabs = navigation
        .getState()
        ?.routes.find((route) => route.name === 'Tabs')?.state;
      const activeTab = tabs?.routes[tabs.index ?? 0]?.name;
      navigation.reset({
        index: 1,
        routes: [
          {
            name: 'Tabs',
            state: activeTab ? { index: 0, routes: [{ name: activeTab }] } : undefined,
          },
          // The score, not the piece screen. The musician just photographed a
          // part and the only question they have is what came off it.
          { name: 'PieceScore', params: { pieceId: piece.id } },
        ],
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The piece could not be saved. Try again.',
      );
    }
  }

  if (pages.length === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Nothing to name"
          description="Photograph a page of sheet music first."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  if (unavailable) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Reading a page needs the backend"
          description="This build runs on sample data, so there is nothing to read your photographs. Enter the piece by hand instead."
          actionLabel="Back to pages"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const busy = transcribe.isPending;

  return (
    <ScreenContainer
      // Pinned, so the one action on the screen sits under the thumb rather
      // than at the end of a scroll past the photograph (§3 law 7).
      footer={
        <View>
          <SendingLine
            progress={progress}
            sent={sent}
            failed={uploadFailed}
            pageCount={pages.length}
            onRetry={retryUpload}
          />
          <PrimaryButton
            label="Save piece"
            onPress={() => void save()}
            loading={busy}
            disabled={busy || uploadFailed !== null}
            style={styles.save}
          />
        </View>
      }
    >
      <PageHeader
        eyebrow={pages.length === 1 ? '1 page' : `${pages.length} pages`}
        title="Name this piece"
        onBack={() => navigation.goBack()}
        backLabel="Back to pages"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        The title is usually printed on the page below. Saving adds the piece
        straight away and the notes are read after that — you can watch it or
        leave it running.
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
        printed on it — and paging through matters more now than it did, since
        the title can be on any sheet of a part whose pages are all read.
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
    </ScreenContainer>
  );
}

/**
 * What the upload is doing, in one line above the button.
 *
 * **A line, not a panel.** The upload is no longer the subject of the screen —
 * naming is — so it reports in the smallest form that still says something
 * true, and says nothing at all once it has finished. A card here would be a
 * second focal point for the one thing on the screen nobody has to do (§3 laws
 * 3 and 4).
 */
function SendingLine({
  progress,
  sent,
  failed,
  pageCount,
  onRetry,
}: {
  progress: PageUploadProgress | null;
  sent: boolean;
  failed: string | null;
  pageCount: number;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <View style={styles.sending}>
        <Text variant="metadataSmall" color="textSecondary">
          {failed}
        </Text>
        <Text
          variant="metadataSmall"
          color="accent"
          onPress={onRetry}
          accessibilityRole="button"
          style={styles.retry}
        >
          Send the pages again
        </Text>
      </View>
    );
  }

  // Finished, and silent about it. A "pages sent ✓" line would be one more
  // thing to read on a screen asking for one thing.
  if (sent || !progress) {
    return null;
  }

  return (
    <View style={styles.sending}>
      <UploadProgress
        sent={progress.sent}
        total={progress.bytes}
        note={
          pageCount > 1 ? `Sending page ${progress.page} of ${progress.total}` : null
        }
      />
    </View>
  );
}

/**
 * The sentence to show for a failed upload.
 *
 * The three error types this flow raises are written for a musician and say
 * which of the several ways it can fail actually happened — reading the file
 * off the device, sending it, or the API refusing. Anything else reaching here
 * is a bug, and its message is written for whoever fixes it: iOS Safari's "Load
 * failed" once ended up on screen as the app's own account of a failed scan.
 */
function describeScanFailure(cause: unknown): string {
  if (
    cause instanceof UploadError ||
    cause instanceof ScanUploadError ||
    cause instanceof ApiError
  ) {
    return cause.message;
  }
  return 'The pages could not be sent. Check your connection and try again.';
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
  sending: {
    marginBottom: spacing.lg,
  },
  retry: {
    marginTop: spacing.xs,
  },
  save: {
    marginTop: 0,
  },
});
