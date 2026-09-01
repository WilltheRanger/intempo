import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { Images, X, Zap, ZapOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Text } from '../../components/primitives/Text';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  captureSession,
  MAX_SCAN_PAGES,
  useCapturedPages,
} from '../../data/captureSession';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { ViewfinderPage } from './ViewfinderPage';

const CAPTURE_BUTTON_SIZE = 68;

/**
 * Photographing a page of sheet music.
 *
 * **The camera is real now.** This screen used to render one of four bundled
 * repo images in the viewfinder and append that same image on the shutter — so
 * every scan in the app produced stock pages, whatever the phone was pointed
 * at, and the upload built on top of it was uploading a fixture. The chrome is
 * unchanged; only the picture behind it became true.
 *
 * **A laptop webcam previews mirrored, and the photograph does not.**
 * `ExpoCamera.web.js` applies `scaleX(-1)` on `native.type === front` alone and
 * ignores the `mirror` prop entirely, so a machine whose only camera is
 * user-facing mirrors the preview whatever `facing` says. Measured rather than
 * assumed: the preview carried `scaleX(-1)` while the captured file came back
 * the other way round — so the **file is true** and OCR reads a correct page;
 * only the picture you frame against is reversed. Countering it here was
 * rejected because nothing in the props says whether the flip was applied, so
 * the counter would mirror a real back camera on a phone browser — trading a
 * confusing preview on a laptop for a wrong one on the target device. A phone's
 * back camera resolves to `back` and is never mirrored.
 *
 * **Nothing falls back to a fake page.** A device with no camera, or a refused
 * permission, gets a plain explanation and the two routes that still work —
 * import, or typing the piece in. Substituting a stock image for the page
 * someone believes they just photographed is the worst thing this screen could
 * do: it would flow all the way through OCR and into their library under a
 * title they chose.
 */
export function ScannerScreen() {
  const navigation = useNavigation<RootNavigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'Scanner'>>();
  const insets = useSafeAreaInsets();
  const pages = useCapturedPages();
  const [flashOn, setFlashOn] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<CameraView>(null);

  // Opening the scanner starts a new session. Coming back from review to add
  // another page doesn't remount this screen, so the pages survive that.
  //
  // **Unless it was opened to retake a page, or to add one to a scan already
  // in progress** — in both cases resetting would destroy the very scan the
  // photograph is joining. Not hypothetical: pages that arrived through
  // Import have no scanner under the review list at all, so both routes push
  // a *fresh* viewfinder, and this effect used to wipe the whole import on
  // its way in.
  //
  // Asking the session whether it has pages would not do. An abandoned scan
  // nobody came back to looks exactly like one being added to, and appending
  // a new piece's first page to it is the failure this reset exists to
  // prevent. Only the caller knows which it is, so the caller says.
  useEffect(() => {
    if (!captureSession.retaking() && !route.params?.adding) {
      captureSession.reset();
    }
  }, []);

  // Asked once, on arrival, rather than behind a button: the screen is a
  // viewfinder and it cannot show one without this. `canAskAgain` false means
  // the system dialog will never appear again, so asking would do nothing.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission?.granted, permission?.canAskAgain]);

  const lastPage = pages[pages.length - 1];
  const FlashIcon = flashOn ? Zap : ZapOff;
  const ready = permission?.granted === true;
  const retaking = captureSession.retaking() !== null;
  const canCapture = ready && (retaking || pages.length < MAX_SCAN_PAGES);

  async function handleCapture() {
    if (!ready || busy) {
      return;
    }
    if (!retaking && pages.length >= MAX_SCAN_PAGES) {
      setError(`A score can have at most ${MAX_SCAN_PAGES} pages in one scan.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const photo = await camera.current?.takePictureAsync({
        quality: 0.8,
        // The bytes are uploaded from this URI, and holding a whole page as a
        // base64 string in JS memory for every page is how a scanner runs a
        // phone out of heap.
        base64: false,
      });
      if (!photo?.uri) {
        throw new Error('The camera returned no image.');
      }
      impact(ImpactFeedbackStyle.Medium);
      // Where it lands is the session's decision, not this screen's — see
      // `capture`. A retake swaps the new photograph in where the old one sat
      // and you are finished; an ordinary capture leaves you here for the next
      // page.
      const outcome = captureSession.capture(photo.uri);
      if (outcome === 'full') {
        setError(`A score can have at most ${MAX_SCAN_PAGES} pages in one scan.`);
        return;
      }
      if (outcome === 'replaced') {
        navigation.navigate('CapturedPages');
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'That photo could not be taken.',
      );
    } finally {
      setBusy(false);
    }
  }

  function handleDone() {
    navigation.navigate('CapturedPages');
  }

  function handleClose() {
    // Abandoning a retake goes back to the pages, not out of the flow. The
    // rest of the scan is still in the session, and this screen is the only
    // one that clears it — leaving by the front door would strand every other
    // page with nothing able to reach them again.
    if (captureSession.retaking()) {
      captureSession.cancelRetake();
      navigation.navigate('CapturedPages');
      return;
    }
    navigation.goBack();
  }

  return (
    <View style={styles.screen}>
      {/* Light status bar content over the dark viewport. */}
      <StatusBar style="light" />

      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
          style={styles.iconButton}
        >
          <X
            size={ICON_SIZE.lg}
            strokeWidth={ICON_STROKE_WIDTH}
            color={colors.actionText}
          />
        </Pressable>

        <Text
          variant="metadataSmall"
          color={pages.length > 0 ? 'actionText' : 'onDarkMuted'}
        >
          {pageCountLabel(pages.length)}
        </Text>

        <Pressable
          onPress={() => setFlashOn((on) => !on)}
          accessibilityRole="button"
          accessibilityLabel={flashOn ? 'Turn flash off' : 'Turn flash on'}
          accessibilityState={{ selected: flashOn }}
          style={styles.iconButton}
        >
          <FlashIcon
            size={ICON_SIZE.lg}
            strokeWidth={ICON_STROKE_WIDTH}
            color={flashOn ? colors.actionText : colors.onDarkMuted}
          />
        </Pressable>
      </View>

      <View style={styles.viewfinder}>
        <ViewfinderPage>
          {ready ? (
            <CameraView
              ref={camera}
              style={styles.camera}
              facing="back"
              enableTorch={flashOn}
              // Stills only. Asking for the microphone here would put a second
              // permission prompt in front of a screen that photographs paper.
              mode="picture"
            />
          ) : (
            <View style={styles.unavailable}>
              <Text variant="metadataSmall" color="onDarkMuted" style={styles.unavailableText}>
                {cameraMessage(permission)}
              </Text>
            </View>
          )}
        </ViewfinderPage>

        {ready ? (
          <Text variant="metadataSmall" color="onDarkMuted" style={styles.guide}>
            Fill the frame · keep the page flat · avoid shadows
          </Text>
        ) : null}

        {error || (!retaking && pages.length >= MAX_SCAN_PAGES) ? (
          <Text variant="metadataSmall" color="onDarkMuted" style={styles.error}>
            {error ?? `Maximum of ${MAX_SCAN_PAGES} pages reached. Tap Done to continue.`}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.lg },
        ]}
      >
        <View style={styles.bottomSlot}>
          {lastPage ? (
            <Pressable
              onPress={handleDone}
              accessibilityRole="button"
              accessibilityLabel={`Review ${pageCountLabel(pages.length)}`}
              style={styles.lastCapture}
            >
              <ScoreThumbnail
                source={lastPage.source}
                style={styles.lastCaptureImage}
              />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => navigation.navigate('AddPiece', { option: 'import' })}
              accessibilityRole="button"
              accessibilityLabel="Import images instead"
              style={styles.iconButton}
            >
              <Images
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE_WIDTH}
                color={colors.actionText}
              />
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => void handleCapture()}
          disabled={!canCapture || busy}
          accessibilityRole="button"
          accessibilityLabel={
            !ready
              ? 'Capture page unavailable'
              : canCapture
                ? 'Capture page'
                : `Maximum of ${MAX_SCAN_PAGES} pages reached`
          }
          accessibilityState={{ disabled: !canCapture || busy }}
          style={({ pressed }) => [
            styles.captureRing,
            pressed && styles.capturePressed,
            (!canCapture || busy) && styles.captureDisabled,
          ]}
        >
          <View style={styles.captureCore} />
        </Pressable>

        <View style={[styles.bottomSlot, styles.doneSlot]}>
          <Pressable
            onPress={handleDone}
            disabled={pages.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Done capturing"
            accessibilityState={{ disabled: pages.length === 0 }}
            style={styles.doneButton}
          >
            <Text
              variant="button"
              color={pages.length === 0 ? 'onDarkMuted' : 'actionText'}
            >
              Done
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Why there is no picture, in the musician's terms.
 *
 * Three genuinely different situations, and lumping them together would leave
 * someone tapping a dead shutter with no idea whether to change a setting, plug
 * in a webcam, or give up and type the piece in.
 */
function cameraMessage(
  permission: ReturnType<typeof useCameraPermissions>[0],
): string {
  if (!permission) {
    return 'Starting the camera…';
  }
  if (!permission.canAskAgain) {
    return 'InTempo does not have camera access. Turn it on in your device settings, or add the piece by hand instead.';
  }
  return 'InTempo needs your camera to photograph sheet music.';
}

function pageCountLabel(count: number): string {
  if (count === 0) {
    return 'No pages yet';
  }
  return count === 1 ? '1 page' : `${count} pages`;
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
    width: '100%',
  },
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  unavailableText: {
    textAlign: 'center',
  },
  guide: {
    marginTop: spacing.lg,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  error: {
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  captureDisabled: {
    opacity: 0.4,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.actionBg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  bottomSlot: {
    width: 64,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  doneSlot: {
    alignItems: 'flex-end',
  },
  lastCapture: {
    borderRadius: radii.sm,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.onDarkMuted,
    overflow: 'hidden',
  },
  lastCaptureImage: {
    width: 44,
    height: 58,
  },
  captureRing: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.actionText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capturePressed: {
    opacity: 0.7,
  },
  captureCore: {
    width: CAPTURE_BUTTON_SIZE - 14,
    height: CAPTURE_BUTTON_SIZE - 14,
    borderRadius: (CAPTURE_BUTTON_SIZE - 14) / 2,
    backgroundColor: colors.actionText,
  },
  doneButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
});
