import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { Images, X, Zap, ZapOff } from '../../components/icons';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../components/primitives/EmptyState';
import { PageHeader } from '../../components/primitives/PageHeader';
import { ScreenContainer } from '../../components/primitives/ScreenContainer';
import { Text } from '../../components/primitives/Text';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { legibilityOf } from '../../lib/scan/legibility';
import {
  shotVerdict,
  viewfinderGuide,
  type ShotVerdict,
} from '../../lib/scan/shotVerdict';
import { photographWithSystemCamera } from '../../lib/scan/systemCamera';
import { captureFailure, type CaptureFailure } from '../../lib/scan/captureFailure';
import {
  cameraFallback,
  type CameraAction,
  type FallbackRoute,
} from '../../lib/scan/cameraFallback';
import { pageSamples } from '../../lib/scan/pageSamples';
import {
  captureSession,
  MAX_SCAN_PAGES,
  useCapturedPages,
} from '../../data/captureSession';
import {
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { PageStrip, STRIP_HEIGHT } from './PageStrip';
import { ViewfinderPage } from './ViewfinderPage';
import { cropToViewfinder, PAGE_ASPECT, visibleRegion } from '../../lib/scan/framing';
import { pageCountLabel } from '../../lib/format';

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
  const goBack = useGoBack({ tab: 'Library' });
  const route = useRoute<RouteProp<RootStackParamList, 'Scanner'>>();
  const insets = useSafeAreaInsets();
  const pages = useCapturedPages();
  const [flashOn, setFlashOn] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The shutter itself failing, which is a screen rather than a line.
   *
   * Separate from `error`, which carries the notices that belong *under* a
   * working viewfinder — the page ceiling, a settings screen that would not
   * open. This one means the button the musician just pressed did nothing, and
   * offering them the same button again with a sentence above it is the dead
   * end `captureFailure.ts` was written about.
   */
  const [failure, setFailure] = useState<CaptureFailure | null>(null);
  //: The page just taken that will not read, and why. Null when the last shot
  //: was fine, could not be measured, or has been retaken.
  /**
   * The page just taken, and what the app makes of it.
   *
   * **Every shot now gets one**, where only a doubtful one used to. The
   * measurement was always there — `legibilityOf` counts staff spacing in the
   * real pixels — and spending it on silence for a good page means silence and
   * approval look identical, which is how a page nobody checked reaches the
   * reader.
   */
  const [shot, setShot] = useState<{ id: string; verdict: ShotVerdict } | null>(null);
  /** What the last measured page turned out to be, for the viewfinder's guide. */
  const [lastVerdict, setLastVerdict] = useState<ShotVerdict | null>(null);
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
    // Mount only, and the params are read at mount on purpose: this is the
    // answer to "how was the viewfinder opened", which cannot change while it
    // is open. Re-running on a params change would reset a scan mid-flight —
    // the exact failure the paragraph above is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asked once, on arrival, rather than behind a button: the screen is a
  // viewfinder and it cannot show one without this. `canAskAgain` false means
  // the system dialog will never appear again, so asking would do nothing.
  //
  // The two facts are pulled out as booleans rather than depending on
  // `permission`, which is a fresh object every time the hook re-reads the
  // status: `!granted && canAskAgain` would then be re-evaluated on an object
  // that says the same thing, and on any platform that answers a denial with
  // `canAskAgain` still true, that is a permission dialog in a loop. Both are
  // false while `permission` is null, which is the "still loading, ask
  // nothing" case the old `permission &&` guard covered.
  const cameraGranted = permission?.granted === true;
  const canAskForCamera = permission?.canAskAgain === true;
  useEffect(() => {
    if (!cameraGranted && canAskForCamera) {
      void requestPermission();
    }
    // `requestPermission` is `useCallback`-stable — expo-modules-core keys it
    // on a module-level method — so naming it costs nothing and stops this
    // going stale if that ever changes.
  }, [cameraGranted, canAskForCamera, requestPermission]);

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
    } catch {
      // **The cause is deliberately not shown.** Everything reaching here is
      // either this screen's own sentence or a platform message written for
      // whoever fixes it, and `TranscribeScreen` has the scar: iOS Safari's
      // "Load failed" once stood on screen as the app's explanation of a
      // failed scan. `captureFailure` says the same thing every time, in
      // words meant for a musician.
      setFailure(captureFailure());
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
    const verdict = shotVerdict(legibilityOf(await pageSamples(uri)), pageRows);
    // On the page, not only in this screen's state. The panel below shows it
    // once; the strip and the review list read it back off the session for as
    // long as the page is in the scan — see `CapturedPage.reading`.
    captureSession.noteReading(id, verdict);
    setShot({ id, verdict });
    setLastVerdict(verdict);
  }

  function retakeDoubtful() {
    if (!shot) {
      return;
    }
    // The existing retake path, unchanged: the page stays until a photograph
    // replaces it, and `capture` swaps the new one in where the old one sits.
    captureSession.beginRetake(shot.id);
    retakingHere.current = true;
    setShot(null);
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
    if (!shot || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const id = shot.id;
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
      setShot(null);
      // Checked again, with the size left unstated: nothing here measured the
      // camera app's output, and a page that is still too small after using it
      // needs "move in", not the same suggestion a second time.
      const taken = captureSession.current().find((page) => page.source === uri);
      if (taken) {
        void checkItReads(taken.id, uri);
      }
    } catch {
      captureSession.cancelRetake();
      setFailure(captureFailure());
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
    if (route === 'settings') {
      // Offered only where the OS owns the permission, which
      // `cameraFallback` decides — a browser's site controls live behind the
      // address bar and no page can open them. Same recovery the recording
      // screen offers for the microphone, and the same failure text if the
      // platform declines to open anything.
      try {
        await Linking.openSettings();
      } catch {
        setError(
          'Open your device Settings, choose InTempo, and allow Camera. Then return to this screen.',
        );
      }
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
    goBack();
  }

  /**
   * The shutter failed, so this screen stops being a viewfinder.
   *
   * In the app's own palette rather than the scanner's ink, like every other
   * failure it has: the camera is not the subject any more, and a dark screen
   * with no picture on it reads as the camera still trying.
   */
  if (failure) {
    return (
      <ScreenContainer>
        {/*
          No heading: the finding is centred below, which is the case
          `PageHeader.title` is documented optional for. The back row still
          belongs here, because the negative offset that makes it a 44pt
          target lives in that component.
        */}
        <PageHeader onBack={() => setFailure(null)} backLabel="Back to the scanner" />
        <EmptyState
          fill
          title={failure.headline}
          description={failure.body}
          hint={failure.hint}
          actionLabel={failure.retakeLabel}
          actionTone="primary"
          onActionPress={() => setFailure(null)}
          // The way *round* the failure rather than back into it. The camera
          // app needs no stream from this page, so it is a genuinely different
          // route — see `captureFailure.ts`.
          secondaryLabel={failure.cameraAppLabel}
          // `takeFallbackRoute`, not `retakeWithSystemCamera`: nothing was
          // taken, so there is no page to replace, and that function returns
          // early without a `shot`. A control that looks live and does nothing
          // is the affordance §3 rules out drawing at all.
          onSecondaryPress={() => void takeFallbackRoute('systemCamera')}
        />
      </ScreenContainer>
    );
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
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <X
            size={ICON_SIZE.lg}
            strokeWidth={ICON_STROKE_WIDTH}
            color={colors.onDark}
          />
        </Pressable>

        {/*
          **The strip stands where "3 pages" stood.** It says the count and two
          things the count could not: which pages, and in what order — the order
          being the one promise this flow makes and the one it never showed. The
          slot keeps its height either way so the first photograph does not push
          the viewfinder down the screen.
        */}
        <View style={styles.count}>
          {pages.length > 0 ? (
            <PageStrip pages={pages} onOpen={handleDone} />
          ) : (
            <Text variant="metadataSmall" color="onDarkMuted">
              {pageCountLabel(0)}
            </Text>
          )}
        </View>

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
            aria-pressed={flashOn}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <FlashIcon
              size={ICON_SIZE.lg}
              strokeWidth={ICON_STROKE_WIDTH}
              color={flashOn ? colors.onDark : colors.onDarkMuted}
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
              {fallback?.actions.map((action) => (
                <FallbackAction
                  key={action.route}
                  action={action}
                  onPress={(route) => void takeFallbackRoute(route)}
                />
              ))}
            </View>
          )}
        </ViewfinderPage>

        {/*
          **One slot under the frame, and two things that could fill it.**
          The guide is advice about the shot you are *about* to take; the
          verdict is the finding on the one you just took. They are never both
          the answer at the same moment, and drawing them together would put
          two pieces of advice under one page and leave the musician to work
          out which is current (§3 law 4).

          **The slot is reserved rather than sized to its contents.** Both live
          under a frame that the viewfinder centres, so a one-line guide
          becoming a three-line verdict pushed the page itself up 90pt at the
          moment of the shutter — the one moment a musician is looking at the
          frame to see what they got. The empty space below is space this
          screen has anyway.
        */}
        <View style={styles.readout}>
          {ready && shot && !error ? (
            <ShotPanel
              verdict={shot.verdict}
              onKeep={() => setShot(null)}
              onRetake={
                shot.verdict.retake === 'cameraApp'
                  ? () => void retakeWithSystemCamera()
                  : retakeDoubtful
              }
            />
          ) : ready ? (
            <Text variant="metadataSmall" color="onDarkMuted" style={styles.guide}>
              {/*
                Measured, not generic. The static line said the same three
                things to a musician whose last four pages read perfectly and
                to one who has just had two come back too small — see
                `viewfinderGuide`.
              */}
              {viewfinderGuide(lastVerdict)}
            </Text>
          ) : null}
        </View>

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
        {/*
          **The thumbnail of the last page used to live here**, and the strip
          above says everything it said and more — every page, in order, with a
          mark on the doubtful one. Two pictures of the same scan on one screen
          is the element §3 law 10 asks to remove.

          What the slot carries instead is the route that had nowhere else to
          be: photographs already on the phone. It was offered only before the
          first shot, so a musician who photographed page one and then realised
          page two was already in their camera roll had to abandon the scan to
          reach it.
        */}
        <View style={styles.bottomSlot}>
          <Pressable
            onPress={() =>
              navigation.navigate('AddPiece', {
                option: 'import',
                adding: pages.length > 0,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={
              pages.length > 0 ? 'Add photos from this device' : 'Import images instead'
            }
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Images
              size={ICON_SIZE.lg}
              strokeWidth={ICON_STROKE_WIDTH}
              color={colors.onDark}
            />
          </Pressable>
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
            pressed && styles.pressed,
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
            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
          >
            <Text
              variant="button"
              color={pages.length === 0 ? 'onDarkMuted' : 'onDark'}
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
/** One control under the no-viewfinder message. */
function FallbackAction({
  action,
  onPress,
}: {
  action: CameraAction;
  onPress: (route: FallbackRoute) => void;
}) {
  return (
    <Text
      variant="metadataSmall"
      color="onDark"
      onPress={() => onPress(action.route)}
      accessibilityRole="button"
      style={styles.unavailableAction}
    >
      {action.label}
    </Text>
  );
}

/**
 * What the app makes of the page just taken, and the two ways on from it.
 *
 * **The measurement was always here and was spent on silence.** Only a page
 * too small to read said anything; everything else got nothing, so a page
 * nobody had checked and a page that had passed looked identical. This says
 * both, which is the whole argument of the frame: a wrong photograph costs one
 * tap here and a failed transcription several screens and several minutes
 * later, with the music already back in its case.
 *
 * **Not a card** (§3 law 3). It is type on the screen's own ground — headline,
 * then why, then the pair of controls — and the only filled thing on it is the
 * one control the verdict actually recommends. Which one that is flips with
 * the verdict and is decided in `lib/scan/shotVerdict.ts`, where a test can see
 * it; a screen that filled "Keep it" unconditionally would put its weight
 * behind keeping the one page the app has just said it cannot read.
 */
function ShotPanel({
  verdict,
  onKeep,
  onRetake,
}: {
  verdict: ShotVerdict;
  onKeep: () => void;
  onRetake: () => void;
}) {
  const keepFirst = verdict.primary === 'keep';
  const keep = (
    <PanelAction
      key="keep"
      label={verdict.keepLabel}
      filled={keepFirst}
      onPress={onKeep}
    />
  );
  const retake = (
    <PanelAction
      key="retake"
      label={verdict.retakeLabel}
      filled={!keepFirst}
      onPress={onRetake}
    />
  );
  return (
    <View style={styles.shot}>
      {/*
        **`accent`, not `accentText`.** This screen's ground is ink, and the
        plain accent measures 4.52:1 against it — the darker text token would
        fall to 3.26 and fail. Which ground the text sits on decides; see
        `colors.accentText`.

        And not a verdict colour: `colors.ts` quarantines that trio to the
        screen that reports how a take went. A photograph is not a performance.
      */}
      <Text
        variant="button"
        color={verdict.tone === 'doubtful' ? 'accent' : 'onDark'}
        style={styles.shotHeadline}
      >
        {verdict.headline}
      </Text>
      <Text variant="metadataSmall" color="onDarkMuted" style={styles.shotBody}>
        {verdict.body}
      </Text>
      {/* Recommended one first, so reading order and weight agree. */}
      <View style={styles.shotActions}>{keepFirst ? [keep, retake] : [retake, keep]}</View>
    </View>
  );
}

/** One of the pair under a verdict. */
function PanelAction({
  label,
  filled,
  onPress,
}: {
  label: string;
  filled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.shotAction,
        filled && styles.shotActionFilled,
        pressed && styles.pressed,
      ]}
    >
      <Text variant="metadata" color={filled ? 'darkBg' : 'onDark'}>
        {label}
      </Text>
    </Pressable>
  );
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
  readout: {
    // The verdict's own height, measured at 390pt with the longest of the four
    // bodies: headline, three lines of reason, and the pair of controls.
    // `minHeight`, so a longer body grows the slot rather than being clipped —
    // it is the *shrinking* that moved the frame.
    minHeight: 148,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  guide: {
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  error: {
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  shot: {
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  shotHeadline: {
    textAlign: 'center',
  },
  shotBody: {
    marginTop: spacing.xs,
    textAlign: 'center',
    // The body is the reason, and a reason that runs the full width of a phone
    // reads as a paragraph rather than as a caption on the page above it.
    maxWidth: 300,
  },
  shotActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  shotAction: {
    // Both axes, like Done below: "Keep it" measures under 44pt wide.
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    // `md`, not `pill`. `radii.ts` reserves the pill for shapes that carry
    // meaning and says in as many words that it is not a default for buttons.
    borderRadius: radii.md,
  },
  shotActionFilled: {
    backgroundColor: colors.onDark,
  },
  captureDisabled: {
    opacity: 0.4,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.darkBg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  count: {
    // Fixed height, so an empty scan and a scan with pages put the frame in
    // the same place; `flex` so the strip scrolls in whatever the two icon
    // buttons leave rather than widening the bar.
    flex: 1,
    height: STRIP_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
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
  captureRing: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.onDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Every control on this screen answers a press the same way.
   *
   * **An opacity dip rather than a tint, because there is no surface to
   * tint** — these sit on a live viewfinder, and `colors.surfacePressed` is a
   * light-ground token that would be invisible over a photograph. 0.7 is what
   * the shutter already used; the other five had no feedback at all until
   * 2026-09-14, including **Done**, which ends the whole scan.
   */
  pressed: {
    opacity: 0.7,
  },
  captureCore: {
    width: CAPTURE_BUTTON_SIZE - 14,
    height: CAPTURE_BUTTON_SIZE - 14,
    borderRadius: (CAPTURE_BUTTON_SIZE - 14) / 2,
    backgroundColor: colors.onDark,
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
