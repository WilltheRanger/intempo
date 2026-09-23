import { useNavigation } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { UploadProgress } from '../../components/score/UploadProgress';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import { IS_LIVE_BACKEND } from '../../data/environment';
import { describeScanFailure } from '../../lib/scan/describeFailure';
import { uploadPage } from '../../lib/scan/uploadPage';
import { uploadPages } from '../../lib/scan/uploadPages';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/**
 * Uploading the captured page to storage.
 *
 * **This screen used to be a `setTimeout`.** It advanced a bar at 900ms a page
 * and then handed on to a review screen showing a hardcoded fixture; nothing
 * was ever sent anywhere. It now performs the real upload and reports what it
 * is actually doing.
 *
 * Every ordered page is uploaded sequentially. Sending them one at a time
 * avoids saturating a phone's uplink, and the same order is handed to the
 * backend's multi-page transcription worker.
 *
 * Transcription itself happens on the *next* step: OCR runs inside
 * `POST /v1/scores`, which needs a title, and only the musician has that. So
 * this screen uploads, and the review screen names and saves.
 */
export function TranscribeScreen() {
  const navigation = useNavigation<RootNavigation>();
  const goBack = useGoBack({ tab: 'Library' });
  const pages = useCapturedPages();
  const total = pages.length;
  const [error, setError] = useState<string | null>(null);
  // Bytes sent for the page currently moving, plus its position in the scan.
  const [progress, setProgress] = useState<{
    page: number;
    sent: number;
    total: number;
  } | null>(null);
  const pageKey = pages.map((page) => page.id).join('|');

  /**
   * Answered before any request goes out.
   *
   * Without this, the sample-data build would try to upload to
   * `http://127.0.0.1:8000` — `api/client.ts`'s default — and fail with
   * "Failed to fetch", which reads as a bug in the app rather than the truth:
   * there is no backend in this build to read a photograph.
   */
  const unavailable = !IS_LIVE_BACKEND;

  useEffect(() => {
    if (pages.length === 0 || unavailable) {
      return;
    }
    // Guards against the upload finishing after the screen has gone — an
    // unmounted `navigation.replace` throws, and a late `setError` warns.
    let live = true;
    // **And stops it, which the flag never did.** `live = false` only made the
    // *result* be ignored; the transfer went on pushing megabytes at storage
    // from a screen that was no longer there. Leaving this screen is either
    // Cancel or Back, and both of them mean stop — but the upload owned the
    // only connection the phone has, so the scan started instead had to share
    // the uplink with the one the musician thought they had abandoned, and
    // every request in the app queued behind the pair of them.
    const abort = new AbortController();

    void (async () => {
      try {
        const keys = await uploadPages(pages, {
          upload: uploadPage,
          signal: abort.signal,
          onProgress: ({ page, sent, total: pageTotal }) => {
            if (live) {
              setProgress({ page, sent, total: pageTotal });
            }
          },
        });
        if (!live) {
          return;
        }
        captureSession.setUploadedImageKeys(keys);
        // `replace`, so Back from the review returns to the pages rather than
        // to an upload that has nothing left to do.
        navigation.replace('TranscriptionReview');
      } catch (cause) {
        if (!live) {
          return;
        }
        // Only messages written to be read. `cause.message` used to be shown
        // for *anything* thrown here, which is how iOS Safari's "Load failed"
        // — the platform's phrasing for a dead connection — ended up on screen
        // as the app's own explanation of a failed scan. `UploadError`,
        // `ScanUploadError` and `ApiError` all carry a sentence meant for a
        // musician; a bare `TypeError` from somewhere unforeseen does not, and
        // saying less is better than saying something meaningless.
        setError(describeScanFailure(cause));
      }
    })();

    return () => {
      live = false;
      abort.abort();
    };
    // Keyed on the page's identity: re-running on every render would upload in
    // a loop, and the page cannot change while this screen is mounted. `pages`
    // is a new array on every render and `navigation` is only used to leave, so
    // naming either would turn one upload into an unbounded number of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, unavailable]);

  if (total === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title="Nothing to transcribe"
          description="Capture at least one page first."
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  if (unavailable) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title="Can’t read photos in sample mode"
          description="Add a piece by hand instead."
          actionLabel="Back to pages"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title={total === 1 ? "The page didn't upload" : "The pages didn't upload"}
          description={error}
          actionLabel="Back to pages"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scrollable={false} contentStyle={styles.centered}>
      <View>
        <Text variant="heroTitle">
          {total === 1 ? 'Sending your page' : `Sending ${total} pages`}
        </Text>

        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          Next, you name it.
        </Text>

        {/*
          A bar, now that there is something to measure.

          This was a spinner, and the comment here defended it: "a single
          upload exposes no milestones this screen can see". That was true of
          `fetch`, which cannot report the progress of a request body at all —
          it was a limitation of the tool, not a fact about the upload. The
          transfer knows exactly how many bytes have gone; `XMLHttpRequest`
          reports it, and this is the one step of a scan whose progress is
          genuinely measured rather than staged.

          It still says nothing before the first byte lands. An empty bar is
          honest about a transfer that has not started.
        */}
        <View style={styles.progress}>
          <UploadProgress
            sent={progress?.sent ?? 0}
            total={progress?.total ?? 0}
            note={total > 1 ? `Page ${progress?.page ?? 1} of ${total}` : null}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <SecondaryButton label="Cancel" onPress={goBack} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // A transient full-screen state; centring it stops the content clinging to
  // the top of an otherwise empty screen.
  centered: {
    justifyContent: 'center',
  },
  subtitle: {
    marginTop: spacing.md,
  },
  progress: {
    marginTop: spacing['3xl'],
  },
  actions: {
    marginTop: spacing['3xl'],
  },
});
