import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { BORDER_WIDTH, colors, motion, radii, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { IconButton } from '../primitives/IconButton';
import { Text } from '../primitives/Text';
import { useInertAppRoot } from './modalAccessibility';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Serif heading at the top of the sheet. */
  title?: string;
  /**
   * Rise to the full height of the screen instead of sizing to the content.
   *
   * For a sheet whose content *is* the task — the bar picker is a page of
   * music to read, and a third of a phone is not enough of it to find bar 40
   * in. The dim strip left above the sheet is still the way out, so the sheet
   * does not become a screen with no exit.
   *
   * The children are given the room: an expanded sheet lays them out in a
   * flexible body, so a scroll view inside it can fill what is left after the
   * header rather than needing a height of its own.
   */
  expand?: boolean;
  children: ReactNode;
}

/** Fallback travel distance for the first frame, before layout is measured. */
const ESTIMATED_HEIGHT = 320;

/**
 * A sheet that rises from the bottom edge.
 *
 * Animated by hand rather than with `Modal`'s `animationType`: the built-in
 * slide moves the backdrop with the sheet, so the dimming would fly in from
 * below instead of fading in place. Reduced motion collapses both to instant.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  expand = false,
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(0);

  // The web Modal is a portal next to #root. Keep that root inert for the
  // complete enter/exit animation so keyboard focus cannot slip behind it.
  useInertAppRoot(mounted);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: reduceMotion ? 0 : motion.base,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? 0 : motion.fast,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [progress, reduceMotion, visible]);

  function handleLayout(event: LayoutChangeEvent) {
    setSheetHeight(event.nativeEvent.layout.height);
  }

  if (!mounted) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            // Pointer dismissal only. A full-screen invisible button is a poor
            // keyboard target and was focused before the sheet's real choices.
            accessible={false}
          />
        </Animated.View>

        <Animated.View
          onLayout={handleLayout}
          style={[
            styles.sheet,
            expand && [styles.expanded, { marginTop: insets.top + spacing.xl }],
            { paddingBottom: insets.bottom + spacing.lg },
            {
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [sheetHeight || ESTIMATED_HEIGHT, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            {title ? (
              <Text variant="pieceTitle" style={styles.title}>
                {title}
              </Text>
            ) : null}
            <IconButton icon={X} label="Close" onPress={onClose} />
          </View>

          {expand ? <View style={styles.body}>{children}</View> : children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  expanded: {
    // Fills the container, which is the screen. The margin above it is the
    // backdrop that dismisses the sheet — a full-bleed sheet with no strip of
    // the screen behind it reads as a screen, and this one has no back.
    flex: 1,
  },
  body: {
    flex: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
  },
});
