import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Images } from '../../components/icons';
import { useGoBack } from '../../navigation/useGoBack';
import { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import {
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import {
  captureSession,
  MAX_SCAN_PAGES,
} from '../../data/captureSession';
import { spacing } from '../../design';
import {
  cameraCanPhotographAPage,
  deviceHints,
} from '../../lib/platform/pageCamera';
import type { RootNavigation } from '../../navigation/types';

/**
 * Bringing in pages that were already photographed.
 *
 * The third route into the library, and the last one that was still a
 * placeholder. It needs almost nothing of its own: pages picked here go into
 * the same `captureSession` the scanner fills, so everything downstream — the
 * page list, the upload, naming, OCR — is the flow that already exists and is
 * already tested. Only the source of the images differs.
 *
 * **Why a button rather than opening the picker on arrival.** On web the picker
 * is a file input, and a browser will only open one inside a user gesture — an
 * effect on mount is silently ignored. So the tap that opens it has to be a
 * real tap. That is also the better screen: it says what is about to happen
 * before the system sheet takes over.
 *
 * No permission is requested up front. `launchImageLibraryAsync` asks for what
 * it needs, when it needs it, and on both platforms picking a specific file
 * grants access to that file alone — asking for the whole library first would
 * request more than this screen uses.
 */
export function ImportPagesScreen({
  attachToPieceId,
  adding = false,
}: {
  attachToPieceId?: string;
  /**
   * Add to the scan in progress rather than replacing it.
   *
   * Set only by "Add page" on the review list. Importing normally *starts* a
   * piece, and that reset is what stops an abandoned scan absorbing the first
   * page of the next one — so the caller says which this is, exactly as
   * `Scanner` takes `adding`.
   */
  adding?: boolean;
}) {
  const navigation = useNavigation<RootNavigation>();
  const goBack = useGoBack({ tab: 'Library' });
  /**
   * Where "Add page" returns to, once the images are in the session.
   *
   * `useGoBack` rather than a bare `navigation.goBack()`, which
   * `goBack.test.ts` refuses and is right to: on a screen opened directly —
   * and `/add/import` is a real URL in the web build — `goBack` is a no-op, so
   * the pages would land in the scan and the musician would be left on the
   * picker with nothing to press.
   */
  const backToPages = useGoBack({ route: 'CapturedPages', params: undefined });
  // Read once: nothing about the device changes while the screen is open.
  const [hasUsableCamera] = useState(() =>
    cameraCanPhotographAPage(deviceHints(Platform.OS)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read at the moment of picking rather than held in state: the review screen
  // can delete a page while this is open on top of it.
  const room = MAX_SCAN_PAGES - captureSession.current().length;

  async function pick() {
    setBusy(true);
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        // What is left, when adding to a scan that already holds pages. The
        // picker refusing the thirteenth is a better answer than accepting it
        // and dropping it afterwards.
        selectionLimit: adding ? room : MAX_SCAN_PAGES,
        // No cropping. A page of music cropped to a square is a page of music
        // with its music cut off, and the framing that matters was decided when
        // the photograph was taken.
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled) {
        return;
      }
      const assets = result.assets ?? [];
      if (assets.length === 0) {
        setError('Nothing was selected.');
        return;
      }

      const chosen = assets.map((asset) => asset.uri);

      if (adding) {
        // Back to the list this came from, rather than a second copy of it
        // pushed on top: "Add page" is a round trip, and the pages, the order
        // they were dragged into and the scanner underneath all have to
        // survive it.
        const taken = captureSession.appendAll(chosen);
        if (taken < chosen.length) {
          setError(
            taken === 0
              ? `This scan already has ${MAX_SCAN_PAGES} pages, which is the most InTempo can read at once.`
              : `Only ${taken === 1 ? '1 image' : `${taken} images`} fitted. A scan holds ${MAX_SCAN_PAGES} pages.`,
          );
          return;
        }
        backToPages();
        return;
      }

      // A fresh session, exactly as opening the scanner does — importing is
      // starting a new piece, not adding to whatever was photographed earlier.
      captureSession.importAll(chosen, { attachToPieceId });
      navigation.replace('CapturedPages');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Those images could not be opened.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
      **The actions are the footer, not the middle of the page.** This screen
      holds three short paragraphs and does not scroll, so an inline button sat
      at about a third of the way down — the furthest thing from a thumb in the
      app, with the bottom two-thirds empty beneath it. §3 law 7 puts the
      primary action where a thumb reaches, and `PieceDetailScreen` had already
      made exactly this move for exactly this reason.

      Both buttons go, not just the first: separating them would leave "Use the
      camera instead" stranded mid-page as the only control up there, which is
      the problem rather than half of the fix.
    */
    <ScreenContainer
      footer={
        <>
          <PrimaryButton
            label="Choose images"
            icon={Images}
            onPress={() => void pick()}
            loading={busy}
            disabled={busy}
          />

          {/*
            **Not offered on a desktop.** A laptop webcam cannot resolve the gap
            between staff lines — measured on a real page, 25 px at full
            resolution against 4 px at 1280x960, where the server's floor is 8 —
            so the button led to a refusal every time. The refusal's own advice
            was "with a phone rather than a webcam", pointing away from a button
            this screen had just shown. A phone *browser* keeps it: its rear
            camera is the best camera in this product. See
            `cameraCanPhotographAPage`.
          */}
          {hasUsableCamera ? (
            <SecondaryButton
              label="Use the camera instead"
              onPress={() => navigation.replace('Scanner')}
              style={styles.secondary}
            />
          ) : null}
        </>
      }
    >
      <PageHeader
        title="Import score"
        onBack={goBack}
        backLabel="Back"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        Choose photographs of the music you want transcribed. You can pick
        several at once, and reorder them before saving.
      </Text>

      {/*
        Kept with the copy rather than pushed down with the buttons: it is what
        the lede does not have room to say, and a footer is for controls.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
        Choose up to {MAX_SCAN_PAGES} pages. InTempo keeps their order and reads
        all of them.
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
  lede: {
    marginTop: spacing.xs,
  },
  error: {
    marginTop: spacing.lg,
  },
  // The gap between the two footer buttons. `action`'s old `2xl` top margin
  // went with the move: the footer sets its own distance from the content.
  secondary: {
    marginTop: spacing.md,
  },
  caveat: {
    marginTop: spacing.lg,
  },
});
