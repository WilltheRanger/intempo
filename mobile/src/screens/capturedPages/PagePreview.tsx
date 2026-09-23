import { Image } from 'expo-image';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { X } from '../../components/icons';
import { IconButton } from '../../components/primitives/IconButton';
import { Text } from '../../components/primitives/Text';
import { colors, spacing } from '../../design';
import type { CapturedPage } from '../../data/captureSession';
import { uriFor } from '../../lib/scan/uploadPage';

/**
 * The page, big enough to actually review.
 *
 * **The screen above this is headed "Review pages — this is the page InTempo
 * will read", and it showed that page at 52x68 points.** You cannot tell from
 * a thumbnail that size whether a system is cut off at the edge, whether the
 * focus caught the staff lines, or whether a shadow crosses the stave — which
 * are the only three reasons to review a photograph of music at all. The row
 * offered retake, delete and reorder; the one thing it did not offer was
 * looking.
 *
 * That is the same defect this project keeps finding in a different costume:
 * an interface naming something it does not provide. `cameraFallback.ts` was
 * written about advice naming a route that does not exist, and the sheet with
 * the grab handle that dragged nothing is in `CLAUDE.md` §3. A review screen
 * you cannot review from is that, one level up — the promise is in the title.
 *
 * Dark ground rather than the page colour, and it does not invert: this is the
 * same argument the scanner's chrome is built on and the Today hero after it.
 * A photograph is the content, so the surround gets out of its way, in both
 * appearances. `colors.darkBg` is the token that exists for exactly this.
 */

export interface PagePreviewProps {
  /** The page to show, or null when nothing is open. */
  page: CapturedPage | null;
  /** Its 1-based position, for the title. */
  position: number;
  total: number;
  onClose: () => void;
}

export function PagePreview({ page, position, total, onClose }: PagePreviewProps) {
  const uri = page ? uriFor(page) : null;

  return (
    <Modal
      visible={page !== null}
      // **Fade, not slide.** The page is already on screen behind this, small;
      // sliding a second copy in from an edge says "a different thing arrived"
      // when what happened is that the same thing got bigger.
      animationType="fade"
      transparent={false}
      // Android's hardware back and the web's Escape both arrive here. Without
      // it the only way out is the button, and the back gesture would leave
      // the app instead of the preview — the thumb-zone question `CLAUDE.md`
      // §3 asks before shipping any screen.
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View style={styles.ground}>
        <SafeAreaView edges={['top']} style={styles.chrome}>
          <Text variant="sectionLabel" color="onDarkMuted">
            Page {position} of {total}
          </Text>
          <IconButton icon={X} label="Close the page" tone="onDark" onPress={onClose} />
        </SafeAreaView>

        {uri ? (
          <Image
            source={{ uri }}
            style={styles.page}
            // **Contain, never cover.** A page cropped to fill the screen hides
            // exactly the edges somebody opened this to check.
            contentFit="contain"
            // It is the subject of the screen, so it is described rather than
            // announced as decoration.
            accessibilityLabel={`Page ${position}, full size`}
            accessibilityIgnoresInvertColors
            transition={120}
          />
        ) : (
          // A page whose file has gone — a cache cleared under a long scan.
          // Says so rather than showing an empty black rectangle, and the
          // review screen still offers Retake on the row behind this.
          <View style={styles.missing}>
            <Text variant="body" color="onDarkMuted" style={styles.missingText}>
              This photo is gone. Retake the page.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: colors.darkBg,
  },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'web' ? spacing.lg : spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  page: {
    flex: 1,
    width: '100%',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  missingText: {
    textAlign: 'center',
  },
});
