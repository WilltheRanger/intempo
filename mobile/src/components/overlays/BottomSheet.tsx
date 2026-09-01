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

import { BORDER_WIDTH, colors, motion, radii, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { Text } from '../primitives/Text';
import { useInertAppRoot } from './modalAccessibility';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Serif heading at the top of the sheet. */
  title?: string;
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
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>

        <Animated.View
          onLayout={handleLayout}
          style={[
            styles.sheet,
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

          {title ? (
            <Text variant="pieceTitle" style={styles.title}>
              {title}
            </Text>
          ) : null}

          {children}
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
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  title: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
});
