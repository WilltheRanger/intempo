import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { Images, X, Zap, ZapOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Text } from '../../components/primitives/Text';
import { captureSession, useCapturedPages } from '../../data/captureSession';
import type { ThumbnailSource } from '../../data/types';
import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import type { RootNavigation } from '../../navigation/types';
import { ViewfinderPage } from './ViewfinderPage';

/**
 * Stand-in images for captured pages. Real capture writes camera output here
 * instead; nothing else about this screen changes.
 */
export const MOCK_CAPTURES: ThumbnailSource[] = [
  require('../../../assets/fixtures/01_simple_printed.jpg'),
  require('../../../assets/fixtures/02_medium_printed.jpg'),
  require('../../../assets/fixtures/03_complex_printed.jpg'),
  require('../../../assets/fixtures/04_handwritten_clean.jpg'),
];

const CAPTURE_BUTTON_SIZE = 68;

/**
 * Mock document scanner.
 *
 * No camera, no recognition — pressing capture appends a page and updates the
 * count. The chrome is what's being evaluated: how the framing guide sits over
 * a page, where the controls fall under the thumb, and how the count and Done
 * action behave as pages accumulate.
 */
export function ScannerScreen() {
  const navigation = useNavigation<RootNavigation>();
  const insets = useSafeAreaInsets();
  const pages = useCapturedPages();
  const [flashOn, setFlashOn] = useState(false);

  // Opening the scanner starts a new session. Coming back from review to add
  // another page doesn't remount this screen, so the pages survive that.
  useEffect(() => {
    captureSession.reset();
  }, []);

  const lastPage = pages[pages.length - 1];
  const FlashIcon = flashOn ? Zap : ZapOff;

  function handleCapture() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    captureSession.add(MOCK_CAPTURES[pages.length % MOCK_CAPTURES.length]);
  }

  function handleDone() {
    navigation.navigate('CapturedPages');
  }

  return (
    <View style={styles.screen}>
      {/* Light status bar content over the dark viewport. */}
      <StatusBar style="light" />

      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={() => navigation.goBack()}
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
        <ViewfinderPage />
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
          onPress={handleCapture}
          accessibilityRole="button"
          accessibilityLabel="Capture page"
          style={({ pressed }) => [
            styles.captureRing,
            pressed && styles.capturePressed,
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

function pageCountLabel(count: number): string {
  if (count === 0) {
    return 'No pages yet';
  }
  return count === 1 ? '1 page' : `${count} pages`;
}

const styles = StyleSheet.create({
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
