import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  EmptyState,
  LoadingState,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import { IS_LIVE_BACKEND } from '../../data/environment';
import { uploadPage } from '../../lib/scan/uploadPage';
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
export function TranscribeScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();
  const total = pages.length;
  const [error, setError] = useState<string | null>(null);

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
        const url = await uploadPage(first);
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
        setError(
          cause instanceof Error
            ? cause.message
            : 'The upload failed. Check your connection and try again.',
        );
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
          A spinner, not a bar. A single upload exposes no milestones this
          screen can see, and a bar creeping toward a number it is not
          measuring is invented precision — which is exactly what the mocked
          version did, page by page, while doing no work at all.
        */}
        <View style={styles.progress}>
          <LoadingState
            label={
              total > 1
                ? `Page 1 of ${total} — only the first is transcribed`
                : undefined
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
