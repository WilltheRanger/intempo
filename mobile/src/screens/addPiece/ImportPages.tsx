import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Images } from 'lucide-react-native';
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
export function ImportPagesScreen() {
  const navigation = useNavigation<RootNavigation>();
  // Read once: nothing about the device changes while the screen is open.
  const [hasUsableCamera] = useState(() =>
    cameraCanPhotographAPage(deviceHints(Platform.OS)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setBusy(true);
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_SCAN_PAGES,
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

      // A fresh session, exactly as opening the scanner does — importing is
      // starting a new piece, not adding to whatever was photographed earlier.
      captureSession.importAll(assets.map((asset) => asset.uri));
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
    <ScreenContainer>
      <PageHeader
        title="Import score"
        onBack={() => navigation.goBack()}
        backLabel="Back"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        Choose photographs of the music you want transcribed. You can pick
        several at once, and reorder them before saving.
      </Text>

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label="Choose images"
        icon={Images}
        onPress={() => void pick()}
        loading={busy}
        disabled={busy}
        style={styles.action}
      />

      {/*
        **Not offered on a desktop.** A laptop webcam cannot resolve the gap
        between staff lines — measured on a real page, 25 px at full resolution
        against 4 px at 1280x960, where the server's floor is 8 — so the button
        led to a refusal every time. The refusal's own advice was "with a phone
        rather than a webcam", pointing away from a button this screen had just
        shown. A phone *browser* keeps it: its rear camera is the best camera in
        this product. See `cameraCanPhotographAPage`.
      */}
      {hasUsableCamera ? (
        <SecondaryButton
          label="Use the camera instead"
          onPress={() => navigation.replace('Scanner')}
          style={styles.secondary}
        />
      ) : null}

      <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
        Choose up to {MAX_SCAN_PAGES} pages. InTempo keeps their order and reads
        all of them.
      </Text>
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
  action: {
    marginTop: spacing['2xl'],
  },
  secondary: {
    marginTop: spacing.md,
  },
  caveat: {
    marginTop: spacing.xl,
  },
});
