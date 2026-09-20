import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';

import {
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
} from '../../design';
import { SwitchCamera, X } from '../icons';
import { Text } from '../primitives/Text';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { cropToViewfinder, PAGE_ASPECT } from '../../lib/scan/framing';

const CAPTURE_BUTTON_SIZE = 56;
const CONTROL_BUTTON_SIZE = 44;

export interface InlineCameraCaptureProps {
  /** Called with the cropped page once a photograph is taken. */
  onCapture: (uri: string) => void;
  /** Called when the musician backs out without taking a photograph. */
  onCancel: () => void;
}

/**
 * A camera preview sized to sit inside the add-piece sheet, rather than its
 * own full screen.
 *
 * **Deliberately one page, not a scan.** `ScannerScreen` stays the route for
 * everything a multi-page scan needs — flash, per-page legibility checking,
 * retakes, the system-camera fallback for a browser stream that cannot
 * resolve staff lines — none of which fits in a sheet the height of a few
 * inches. This captures the first page only; `CapturedPagesScreen` already
 * offers "add another page", which opens that full scanner for the rest.
 *
 * The crop is the one piece of `ScannerScreen`'s pipeline reused here rather
 * than rebuilt: `cropToViewfinder` trims the sensor's frame down to what the
 * preview actually showed, the same arithmetic either camera uses.
 */
export function InlineCameraCapture({
  onCapture,
  onCancel,
}: InlineCameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  const granted = permission?.granted === true;

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
      });
      if (!photo?.uri) {
        return;
      }
      const framed = await cropToViewfinder(photo.uri, photo.width, photo.height);
      impact(ImpactFeedbackStyle.Medium);
      onCapture(framed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.preview}>
        {granted ? (
          <CameraView
            ref={camera}
            style={styles.camera}
            facing={facing}
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
    // Wider than a full page's aspect ratio — this is a preview inside a
    // sheet, not the viewfinder someone frames a whole page against.
    aspectRatio: PAGE_ASPECT * 1.3,
    maxHeight: 320,
  },
  preview: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.darkBg,
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
