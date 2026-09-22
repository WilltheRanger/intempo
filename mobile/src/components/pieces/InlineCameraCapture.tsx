import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';

import {
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import { Images, SwitchCamera, X, Zap, ZapOff } from '../icons';
import { IconButton } from '../primitives/IconButton';
import { Text } from '../primitives/Text';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { cropToViewfinder, PAGE_ASPECT } from '../../lib/scan/framing';

const CAPTURE_BUTTON_SIZE = 56;
const CONTROL_BUTTON_SIZE = 44;

/**
 * The dimensions a saved photo actually displays at, not what the camera
 * module reported at capture time.
 *
 * **Phone cameras store a portrait photo as a landscape sensor frame plus a
 * rotation tag, not rotated pixels.** `takePictureAsync`'s own `width`/
 * `height` can describe that raw, un-rotated frame; `Image.getSize` reads the
 * file the way every viewer does — EXIF-corrected. Cropping against the
 * wrong one of those still "succeeds" as far as the crop math is concerned —
 * the rectangle is valid, just aimed at the wrong coordinate space — which is
 * how a capture came out as a small, zoomed-in corner of the page instead of
 * the page itself.
 *
 * Falls back to the camera's own numbers if the file can't be read a second
 * time, so a capture is never lost to this being unable to confirm itself.
 */
function displayedImageSize(
  uri: string,
  fallback: { width: number; height: number },
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(fallback),
    );
  });
}

export interface InlineCameraCaptureProps {
  /** Called with the cropped page once a photograph is taken. */
  onCapture: (uri: string) => void;
  /** Called when the musician backs out without taking a photograph. */
  onCancel: () => void;
  /**
   * Called to use a photo already on the phone instead of the live camera.
   *
   * Optional: a screen that already offers its own "choose a photo" action
   * elsewhere — `PieceDetailScreen`, `ImportPages` itself — doesn't need a
   * second one inside the camera too. Omitting it leaves a matching blank
   * space rather than nothing, so the flash toggle on the other side doesn't
   * jump around depending on which screen opened this.
   */
  onChooseImages?: () => void;
}

/**
 * A camera preview sized to sit inside the add-piece sheet, rather than its
 * own full screen.
 *
 * **Deliberately one page, not a scan.** A dedicated full-screen scanner used
 * to be where every camera-related button in this app led — flash, per-page
 * legibility checking, retakes, a system-camera fallback for a browser stream
 * that cannot resolve staff lines. None of that fits in a sheet the height of
 * a few inches, so this captures one page and hands off: `CapturedPagesScreen`
 * already offers "add another page", which opens this same component again
 * rather than a separate screen, and a retake reopens it too — `capture`
 * knows which page it's replacing regardless of which screen asked.
 *
 * The crop is the one piece of the old scanner's pipeline reused here rather
 * than rebuilt: `cropToViewfinder` trims the sensor's frame down to what the
 * preview actually showed, the same arithmetic either camera used.
 */
export function InlineCameraCapture({
  onCapture,
  onCancel,
  onChooseImages,
}: InlineCameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashOn, setFlashOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  const granted = permission?.granted === true;
  // Torch is a back-camera feature; asking the front sensor for one either
  // does nothing or errors, depending on device. Switching to front turns
  // this off rather than leaving a control on screen that stops working.
  const showFlash = granted && facing === 'back';

  async function handleCapture() {
    if (!granted || busy) {
      return;
    }
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({
        quality: 0.95,
        imageType: 'jpg',
        base64: false,
        // The web preview mirrors the front camera for a natural
        // selfie-style view (`ExpoCamera.web.tsx`'s own `scaleX: -1`), but
        // the raw capture is not mirrored to match unless told to be —
        // without this, front-camera shots come out flipped left-right from
        // what was on screen when the shutter was tapped.
        isImageMirror: facing === 'front',
      });
      if (!photo?.uri) {
        return;
      }
      const { width, height } = await displayedImageSize(photo.uri, {
        width: photo.width,
        height: photo.height,
      });
      const framed = await cropToViewfinder(photo.uri, width, height);
      impact(ImpactFeedbackStyle.Medium);
      onCapture(framed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        {onChooseImages ? (
          <IconButton
            icon={Images}
            label="Choose photos instead"
            onPress={onChooseImages}
          />
        ) : (
          <View style={styles.sideControl} />
        )}

        {showFlash ? (
          <IconButton
            icon={flashOn ? Zap : ZapOff}
            label={flashOn ? 'Turn flash off' : 'Turn flash on'}
            onPress={() => setFlashOn((on) => !on)}
          />
        ) : (
          // Keeps "Choose photos" pinned to the left rather than jumping to
          // centre when there is nothing on the right to balance it — the
          // camera not being ready yet, or the front lens being active.
          <View style={styles.sideControl} />
        )}
      </View>

      <View style={styles.preview}>
        {granted ? (
          <CameraView
            ref={camera}
            style={styles.camera}
            facing={facing}
            enableTorch={showFlash && flashOn}
            mode="picture"
          />
        ) : (
          <View style={styles.permissionPrompt}>
            <Text
              variant="metadataSmall"
              color="onDarkMuted"
              style={styles.permissionText}
            >
              {permission === null
                ? 'Starting the camera…'
                : 'InTempo needs your camera to photograph sheet music.'}
            </Text>
            {permission && !permission.granted && permission.canAskAgain ? (
              <Text
                variant="metadataSmall"
                color="onDark"
                onPress={() => void requestPermission()}
                accessibilityRole="button"
                style={styles.permissionAction}
              >
                Allow camera access
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.controls}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={styles.sideControl}
          >
            <X
              size={ICON_SIZE.md}
              strokeWidth={ICON_STROKE_WIDTH}
              color={colors.onDark}
            />
          </Pressable>

          <Pressable
            onPress={() => void handleCapture()}
            disabled={!granted || busy}
            accessibilityRole="button"
            accessibilityLabel="Capture page"
            style={({ pressed }) => [
              styles.shutter,
              pressed && styles.shutterPressed,
              (!granted || busy) && styles.shutterDisabled,
            ]}
          >
            <View style={styles.shutterCore} />
          </Pressable>

          <Pressable
            onPress={() =>
              setFacing((current) => (current === 'back' ? 'front' : 'back'))
            }
            disabled={!granted}
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
            style={styles.sideControl}
          >
            <SwitchCamera
              size={ICON_SIZE.md}
              strokeWidth={ICON_STROKE_WIDTH}
              color={colors.onDark}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Fills the sheet's `expand`ed body and centers the preview inside it —
    // large and in the middle, the way the reference frames it, rather than
    // a small preview sized to whatever's left after a menu of rows.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    // Above the frame, not on it. "Choose photos" and the flash toggle used
    // to sit over the live feed itself; two more things obscuring the one
    // thing this screen is for. This row is outside `preview` entirely.
    width: '97%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  preview: {
    // Most of the sheet's width, not all of it — a preview flush with the
    // rounded sheet's own edges reads as the sheet, not a card inside it.
    width: '97%',
    aspectRatio: PAGE_ASPECT,
    borderRadius: radii.lg,
    overflow: 'hidden',
    // No fill at all. The camera feed covers this the moment permission is
    // granted, so any background color here was only ever visible as a
    // flash before that — a colored box behind something that's supposed
    // to disappear immediately, rather than nothing at all.
  },
  camera: {
    flex: 1,
  },
  permissionPrompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  permissionText: {
    textAlign: 'center',
  },
  permissionAction: {
    textDecorationLine: 'underline',
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    // A scrim under the buttons, the way the reference's own controls sit on
    // a darkened strip rather than directly on the live feed — a white
    // shutter ring needs contrast against whatever the camera is pointed at.
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  sideControl: {
    width: CONTROL_BUTTON_SIZE,
    height: CONTROL_BUTTON_SIZE,
    borderRadius: CONTROL_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.onDarkFill,
  },
  shutter: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.onDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: {
    opacity: 0.7,
  },
  shutterDisabled: {
    opacity: 0.4,
  },
  shutterCore: {
    width: CAPTURE_BUTTON_SIZE - 12,
    height: CAPTURE_BUTTON_SIZE - 12,
    borderRadius: (CAPTURE_BUTTON_SIZE - 12) / 2,
    backgroundColor: colors.onDark,
  },
});
