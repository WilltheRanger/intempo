import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Images } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { captureSession } from '../../data/captureSession';
import { spacing } from '../../design';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setBusy(true);
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
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
      captureSession.reset();
      for (const asset of assets) {
        captureSession.add(asset.uri);
      }
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

      <SecondaryButton
        label="Use the camera instead"
        onPress={() => navigation.replace('Scanner')}
        style={styles.secondary}
      />

      <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
        Only the first page is transcribed. A score spanning several pages
        isn&apos;t supported yet.
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
