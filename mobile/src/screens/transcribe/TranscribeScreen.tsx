import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { UploadProgress } from '../../components/score/UploadProgress';
import { ApiError } from '../../data/api/client';
import { UploadError } from '../../data/api/upload';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import { IS_LIVE_BACKEND } from '../../data/environment';
import { ScanUploadError, uploadPage } from '../../lib/scan/uploadPage';
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
 * **Only the first page.** `POST /v1/scores` takes a single `image_url` and
 * there is no column, table or endpoint for a multi-page score, so a second
 * page has nowhere to go. Uploading pages that would then be discarded would
 * cost the musician time and bandwidth to no end, so they are not uploaded —
 * and the screen says which page it transcribed rather than letting someone
 * discover the omission later.
 *
 * Transcription itself happens on the *next* step: OCR runs inside
 * `POST /v1/scores`, which needs a title, and only the musician has that. So
 * this screen uploads, and the review screen names and saves.
 */
/**
 * The sentence to show for a failed scan.
 *
 * Three error types in this flow are written for a musician and say which of
 * the several ways it can fail actually happened — reading the file off the
 * device, sending it, or the API refusing. Anything else reaching here is a
 * bug, and its message is written for whoever fixes it.
 */
function describeScanFailure(cause: unknown): string {
  if (
    cause instanceof UploadError ||
    cause instanceof ScanUploadError ||
    cause instanceof ApiError
  ) {
    return cause.message;
  }
  return 'The page could not be sent. Check your connection and try again.';
}

export function TranscribeScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();
  const total = pages.length;
  const [error, setError] = useState<string | null>(null);
  //: Bytes sent, out of bytes to send. Null until the transfer reports, which
  //: it does not on a body the platform cannot measure.
  const [sent, setSent] = useState<{ sent: number; total: number } | null>(null);

  const first = pages[0] ?? null;

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
    if (!first || unavailable) {
      return;
    }
    // Guards against the upload finishing after the screen has gone — an
    // unmounted `navigation.replace` throws, and a late `setError` warns.
    let live = true;

    void (async () => {
      try {
        const url = await uploadPage(first, {
          onProgress: (bytes, total) => {
            if (live) {
              setSent({ sent: bytes, total });
            }
          },
        });
        if (!live) {
          return;
        }
        captureSession.setUploadedImageUrl(url);
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
    };
    // Keyed on the page's identity: re-running on every render would upload in
    // a loop, and the page cannot change while this screen is mounted.
  }, [first?.id, unavailable]);

  if (total === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Nothing to transcribe"
          description="Capture at least one page first."
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
          title="Transcription needs the backend"
          description="This build runs on sample data, so there is nothing to read your photograph. Add a piece manually instead."
          actionLabel="Back to pages"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <EmptyState
          title="The page didn't upload"
          description={error}
          actionLabel="Back to pages"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scrollable={false} contentStyle={styles.centered}>
      <View>
        <Text variant="heroTitle">Sending your page</Text>

        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          Uploading the photograph. Reading the notation comes next, once you
          have named the piece.
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
            sent={sent?.sent ?? 0}
            total={sent?.total ?? 0}
            note={
              total > 1
                ? `Page 1 of ${total} — only the first is transcribed`
                : null
            }
          />
        </View>
      </View>

      <View style={styles.actions}>
        <SecondaryButton label="Cancel" onPress={() => navigation.goBack()} />
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
