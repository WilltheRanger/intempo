import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { BORDER_WIDTH, colors, EASE_OUT, motion, radii, spacing, SPRING } from '../../design';
import {
  dragOffset,
  isDragGesture,
  shouldDismiss,
  trimSamples,
  velocityFrom,
  type DragSample,
} from '../../lib/motion/sheetDrag';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { IconButton } from '../primitives/IconButton';
import { Text } from '../primitives/Text';
import { useInertAppRoot } from './modalAccessibility';
import { useOverlayPresence } from './useOverlayPresence';

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
  /**
   * The finger's contribution, kept apart from `progress`.
   *
   * One value could not carry both: `progress` is a 0-1 enter/exit ratio and
   * the drag is a distance, and combining them would make the release
   * animation depend on how far the sheet had been pulled.
   */
  const drag = useRef(new Animated.Value(0)).current;
  const [sheetHeight, setSheetHeight] = useState(0);
  // Read inside the responder, which is created once and would otherwise close
  // over the height as it was on first render — zero.
  const heightRef = useRef(0);
  /**
   * Recent finger positions, for working out how fast it was moving.
   *
   * Velocity is derived from these rather than read from `gestureState.vy`, so
   * the threshold lives in a module with tests. See `sheetDrag.velocityFrom`.
   */
  const samplesRef = useRef<DragSample[]>([]);

  const { mounted, progress } = useOverlayPresence(visible, reduceMotion, (value) => {
    // From nothing each time, or a sheet dismissed by a swipe reopens already
    // pushed off-screen.
    drag.setValue(0);
    return Animated.timing(value, {
      toValue: 1,
      duration: reduceMotion ? 0 : motion.base,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
  });

  // The web Modal is a portal next to #root. Keep that root inert for the
  // complete enter/exit animation so keyboard focus cannot slip behind it.
  useInertAppRoot(mounted);



  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    heightRef.current = next;
    setSheetHeight(next);
  }

  /**
   * Swipe down to dismiss — the gesture the grab handle has always promised.
   *
   * The handle was drawn from the start and nothing dragged it, so the sheet
   * looked dismissible and was not: the only ways out were the close button and
   * a tap on the backdrop, neither of which is what a handle means. A false
   * affordance is worse than none, because it costs a try before you learn it.
   *
   * Built on `PanResponder` rather than a gesture library: this app has none,
   * and adding `react-native-gesture-handler` plus `reanimated` for one
   * interaction is a large dependency and a native rebuild for something the
   * platform already answers.
   */
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Never claimed on touch-down: these sheets are full of buttons, and a
        // responder that takes the touch before it has moved eats their taps.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          isDragGesture(gesture.dx, gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          const now = Date.now();
          samplesRef.current = trimSamples(
            [...samplesRef.current, { dy: gesture.dy, t: now }],
            now,
          );
          drag.setValue(dragOffset(gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          const height = heightRef.current;
          const vy = velocityFrom(samplesRef.current);
          samplesRef.current = [];
          if (shouldDismiss({ dy: gesture.dy, vy, height })) {
            // Carry the sheet the rest of the way, then hand over. Snapping
            // back to closed would throw away the continuity the drag just
            // established.
            Animated.timing(drag, {
              toValue: height || ESTIMATED_HEIGHT,
              duration: reduceMotion ? 0 : motion.fast,
              easing: EASE_OUT,
              useNativeDriver: Platform.OS !== 'web',
            }).start(() => onClose());
            return;
          }
          Animated.spring(drag, {
            toValue: 0,
            useNativeDriver: Platform.OS !== 'web',
            ...SPRING,
          }).start();
        },
        // A system gesture or an incoming call takes the touch away mid-drag;
        // without this the sheet stays wherever the finger left it.
        onPanResponderTerminate: () => {
          samplesRef.current = [];
          Animated.spring(drag, {
            toValue: 0,
            useNativeDriver: Platform.OS !== 'web',
            ...SPRING,
          }).start();
        },
      }),
    [drag, onClose, reduceMotion],
  );

  if (!mounted) {
    return null;
  }

  const enterOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight || ESTIMATED_HEIGHT, 0],
  });
  /**
   * The scrim thins as the sheet is pulled down, so the screen behind it comes
   * back with the gesture rather than only at the end of it. Without this the
   * drag reads as moving a picture of a sheet.
   */
  const backdropOpacity = Animated.multiply(
    progress,
    drag.interpolate({
      inputRange: [0, sheetHeight || ESTIMATED_HEIGHT],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
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
              transform: [{ translateY: Animated.add(enterOffset, drag) }],
            },
          ]}
        >
          {/*
            The grab area: the handle and the title row together, so the target
            is a comfortable strip rather than a 4pt bar.
          */}
          <View {...pan.panHandlers}>
            <View style={styles.handle} />

            <View style={styles.header}>
              {title ? (
                <Text variant="pieceTitle" style={styles.title}>
                  {title}
                </Text>
              ) : null}
              <IconButton icon={X} label="Close" onPress={onClose} />
            </View>
          </View>

          {/*
            `expand` sheets fill the screen and their body scrolls, so their
            drag stays on the grab area — a `PanResponder` competing with a
            `ScrollView` for the same touch is how a list stops scrolling.
            Short sheets have nothing to scroll, so all of them drags.
          */}
          {expand ? (
            <View style={styles.body}>{children}</View>
          ) : (
            <View {...pan.panHandlers}>{children}</View>
          )}
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
