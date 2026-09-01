import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { Images, X, Zap, ZapOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Text } from '../../components/primitives/Text';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { adviceFor, legibilityOf, type Advice } from '../../lib/scan/legibility';
import { photographWithSystemCamera } from '../../lib/scan/systemCamera';
import { cameraFallback, type FallbackRoute } from '../../lib/scan/cameraFallback';
import { pageSamples } from '../../lib/scan/pageSamples';
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
import { cropToViewfinder, PAGE_ASPECT, visibleRegion } from '../../lib/scan/framing';

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
  //: The page just taken that will not read, and why. Null when the last shot
  //: was fine, could not be measured, or has been retaken.
  const [doubt, setDoubt] = useState<{ id: string; advice: Advice } | null>(null);
  /**
   * Whether the retake in flight was started *here*, at the viewfinder.
   *
   * A retake normally begins on the review list, so finishing one returns
   * there — "one shot and you are finished". Started from the doubt line below
   * it means the opposite: the musician is mid-scan with the music in front of
   * them, and sending them to the page list after re-shooting page three of six
   * is the app losing their place.
   */
  const retakingHere = useRef(false);
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
      captureSession.reset({
        attachToPieceId: route.params?.attachToPieceId,
      });
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
  // What to say, and offer, when there is no viewfinder. Null while there is
  // one — see `cameraFallback`, which owns both because the screen it serves
  // cannot be tested.
  const fallback = cameraFallback({
    granted: permission ? permission.granted : null,
    canAskAgain: permission?.canAskAgain ?? true,
    os: Platform.OS,
  });
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
        // **0.95, not 0.8.** This is the *first* encode; `shrink.ts` exists to
        // trade quality away later and only when a page has to fit under a
        // limit, and its own ladder starts at 0.9 — so capturing at 0.8 meant
        // the ladder's gentlest rung re-encoded an already-lossy JPEG and made
        // it larger. JPEG artefacts land hardest on exactly what this
        // photographs: one-pixel staff lines on white paper.
        quality: 0.95,
        // **On web this is the difference between a JPEG and a 20 MB PNG.**
        // `expo-camera`'s browser implementation defaults `imageType` to
        // `'png'` and `toDataURL` ignores `quality` for anything but `'jpg'`,
        // so a 3840x2160 capture arrived as a lossless data URI an order of
        // magnitude too large — held in JS memory, per page — and the quality
        // above was silently discarded. Ignored on iOS and Android, which
        // encode JPEG regardless.
        imageType: 'jpg',
        // The bytes are uploaded from this URI, and holding a whole page as a
        // base64 string in JS memory for every page is how a scanner runs a
        // phone out of heap.
        base64: false,
      });
      if (!photo?.uri) {
        throw new Error('The camera returned no image.');
      }

      // **What the viewfinder showed, not what the sensor saw.** The preview
      // is a portrait page window filled with `cover`, so it crops; the capture
      // did not. Measured here: a 3840x2160 stream behind a 296x408 window
      // means a page that fills the frame occupies 41% of the saved file's
      // width, with two and a half times more desk than the musician chose.
      // "Fill the frame" is printed under the viewfinder, and until now it
      // could be followed exactly and still hand the reader a small, distant
      // page. Falls back to the uncropped photograph — a slightly-too-wide
      // page is a page, and losing the shot to image processing is worse.
      const framed = await cropToViewfinder(photo.uri, photo.width, photo.height);
      impact(ImpactFeedbackStyle.Medium);
      // Where it lands is the session's decision, not this screen's — see
      // `capture`. A retake swaps the new photograph in where the old one sat
      // and you are finished; an ordinary capture leaves you here for the next
      // page.
      const outcome = captureSession.capture(framed);
      if (outcome === 'full') {
        setError(`A score can have at most ${MAX_SCAN_PAGES} pages in one scan.`);
        return;
      }
      const startedHere = retakingHere.current;
      retakingHere.current = false;
      if (outcome === 'replaced' && !startedHere) {
        navigation.navigate('CapturedPages');
        return;
      }

      // **Not awaited, and the shutter is not blocked on it.** Measuring is
      // tens of milliseconds and the answer is advisory: someone shooting a
      // six-page part should not wait for a verdict between pages, and a
      // verdict that arrives after the next shot is about the previous one,
      // which is why it is keyed by page id.
      //
      // Found by source rather than by position: a replacement sits where the
      // page it replaced sat, which is not the end of the list.
      const taken = captureSession.current().find((page) => page.source === framed);
      if (taken) {
        // **The rectangle that will be uploaded, not the sensor's frame.** The
        // crop is what the reader gets, and its height is what decides whether
        // any framing could have worked — see `adviceFor`. Recomputed rather
        // than measured because `visibleRegion` is the same arithmetic
        // `cropToViewfinder` just used, and it is pure.
        const region = visibleRegion(photo.width, photo.height, PAGE_ASPECT);
        void checkItReads(taken.id, framed, region?.height ?? photo.height);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'That photo could not be taken.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Whether the page just taken has enough detail on it to be read.
   *
   * The server answers this too, and its answer is the one that decides
   * anything — but it arrives after the upload, after the queue and after the
   * worker fetches the page, by which time the music is back in its case. Here
   * it costs one more press. See `lib/scan/legibility.ts`, which is
   * deliberately more permissive than the server so it can never talk someone
   * out of a photograph that would have read.
   */
  async function checkItReads(id: string, uri: string, pageRows?: number) {
    const advice = adviceFor(legibilityOf(await pageSamples(uri)), pageRows);
    if (advice) {
      setDoubt({ id, advice });
    }
  }

  function retakeDoubtful() {
    if (!doubt) {
      return;
    }
    // The existing retake path, unchanged: the page stays until a photograph
    // replaces it, and `capture` swaps the new one in where the old one sits.
    captureSession.beginRetake(doubt.id);
    retakingHere.current = true;
    setDoubt(null);
  }

  /**
   * Re-shoot the doubtful page with the phone's own camera app.
   *
   * Offered only when this camera demonstrably cannot do better — see
   * `adviceFor`. It goes through the **same** retake swap as the button beside
   * it: the page stays where it is until a photograph replaces it, so a
   * cancelled camera app leaves the scan exactly as it was. That is the rule
   * `captureSession` was written around and it must not grow an exception here.
   */
  async function retakeWithSystemCamera() {
    if (!doubt || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const id = doubt.id;
    try {
      captureSession.beginRetake(id);
      const uri = await photographWithSystemCamera();
      if (!uri) {
        // Cancelled, or the camera app gave nothing back. Put the scan back
        // the way it was rather than leaving a retake pending on a page the
        // musician is still looking at.
        captureSession.cancelRetake();
        return;
      }
      // No viewfinder crop: the camera app had no page window, so there is
      // nothing it promised to crop to. The whole photograph is the page.
      captureSession.capture(uri);
      impact(ImpactFeedbackStyle.Medium);
      setDoubt(null);
      // Checked again, with the size left unstated: nothing here measured the
      // camera app's output, and a page that is still too small after using it
      // needs "move in", not the same suggestion a second time.
      const taken = captureSession.current().find((page) => page.source === uri);
      if (taken) {
        void checkItReads(taken.id, uri);
      }
    } catch (cause) {
      captureSession.cancelRetake();
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

  /**
   * The one way forward offered when there is no viewfinder.
   *
   * A first page, not a retake: this runs before anything has been
   * photographed, so it goes through `capture` on the session the effect above
   * has already reset — the same path the shutter takes.
   */
  async function takeFallbackRoute(route: FallbackRoute) {
    if (route === 'import') {
      navigation.navigate('AddPiece', { option: 'import' });
      return;
    }
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uri = await photographWithSystemCamera();
      if (!uri) {
        return;
      }
      captureSession.capture(uri);
      impact(ImpactFeedbackStyle.Medium);
      navigation.navigate('CapturedPages');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'That photo could not be taken.',
      );
    } finally {
      setBusy(false);
    }
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

        {/*
          **Gone when there is no camera**, rather than dimmed. It is a torch on
          a camera that is not running: it controls nothing, explains nothing,
          and on the refused-permission screen it sat in the top corner beside a
          real way forward. §3 law 10 — every element must justify its presence.
          The empty view keeps the count centred.
        */}
        {ready ? (
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
        ) : (
          <View style={styles.iconButton} />
        )}
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
                {fallback?.message}
              </Text>
              {fallback?.action ? (
                <FallbackAction
                  action={fallback.action}
                  onPress={(route) => void takeFallbackRoute(route)}
                />
              ) : null}
            </View>
          )}
        </ViewfinderPage>

        {ready ? (
          <Text variant="metadataSmall" color="onDarkMuted" style={styles.guide}>
            Fill the frame · keep the page flat · avoid shadows
          </Text>
        ) : null}

        {/*
          One line, in the only accent on this screen, and only when there is
          something to say. Not a card and not a badge: the page in the frame is
          the subject and the shutter is the action, so this has to be third
          (§3 laws 3, 4 and 5).
        */}
        {doubt && !error ? (
          <View style={styles.doubt}>
            <Text variant="metadataSmall" color="accent" style={styles.doubtText}>
              {doubt.advice.message}
            </Text>
            {/*
              One way out, and which one depends on what went wrong. Offering
              both would put the musician in front of a choice they have no way
              to make: only the app knows whether this camera could have done
              better.
            */}
            <Text
              variant="metadataSmall"
              color="actionText"
              onPress={
                doubt.advice.route === 'cameraApp'
                  ? () => void retakeWithSystemCamera()
                  : retakeDoubtful
              }
              accessibilityRole="button"
              style={styles.doubtAction}
            >
              {doubt.advice.route === 'cameraApp'
                ? 'Open the camera app'
                : 'Take this page again'}
            </Text>
          </View>
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
/**
 * The single control under the no-viewfinder message.
 *
 * Its own component only so the narrowing survives: `fallback.action` is
 * checked at the call site and TypeScript cannot carry that through a closure
 * on an object field.
 */
function FallbackAction({
  action,
  onPress,
}: {
  action: { label: string; route: FallbackRoute };
  onPress: (route: FallbackRoute) => void;
}) {
  return (
    <Text
      variant="metadataSmall"
      color="actionText"
      onPress={() => onPress(action.route)}
      accessibilityRole="button"
      style={styles.unavailableAction}
    >
      {action.label}
    </Text>
  );
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
  unavailableAction: {
    marginTop: spacing.lg,
    textAlign: 'center',
    textDecorationLine: 'underline',
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
  doubt: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  doubtText: {
    textAlign: 'center',
  },
  doubtAction: {
    marginTop: spacing.sm,
    textAlign: 'center',
    textDecorationLine: 'underline',
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
    // Both axes. "Done" is four characters, which measured 40pt wide — a target
    // that clears the minimum vertically and misses it horizontally is still a
    // target that misses it.
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
});
