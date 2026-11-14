import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from '../icons';

import { colors, EASE_OUT, MIN_TOUCH_TARGET, motion, radii, spacing, SPRING } from '../../design';
import {
  dragOffset,
  isDragGesture,
  shouldDismiss,
  trimSamples,
  velocityFrom,
  type DragSample,
} from '../../lib/motion/sheetDrag';
import { recedesBehind } from '../../lib/motion/recede';
import {
  detentDragOffset,
  mediumOffset,
  settleDetent,
  type Detent,
} from '../../lib/motion/sheetDetents';
import { settleVelocity } from '../../lib/motion/springHandoff';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { IconButton } from '../primitives/IconButton';
import { Text } from '../primitives/Text';
import { DismissArea } from './DismissArea';
import { useInertAppRoot, useReturnFocus } from './modalAccessibility';
import { useRecede } from './RecedingSurface';
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
  /**
   * Draw the ✕. On by default, because the scrim is deliberately not a
   * keyboard or screen-reader target (see the backdrop below), which makes the
   * ✕ the accessible way out.
   *
   * Off only for a sheet whose own last row already closes it — the redesign's
   * "Start from" ends on "Choose on the score", which does exactly that — so
   * the sheet is not drawn with two ways to do one thing.
   */
  showClose?: boolean;
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
/**
 * The grab area owns its touches on the web. Without it a drag that began on
 * the handle could also scroll or bounce the page behind the sheet, which is
 * the browser and the sheet both answering one finger (2026-11-12).
 */
const GRAB_AREA_WEB = Platform.select({
  web: { touchAction: 'none' } as unknown as ViewStyle,
  default: undefined,
});

export function BottomSheet({
  visible,
  onClose,
  title,
  expand = false,
  showClose = true,
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

  /*
    **A long sheet's two heights** (`lib/motion/sheetDetents.ts`, the owner,
    2026-11-13). An `expand` sheet opens at half the window and the grab bar
    takes it to the full height; `detent` is where it rests above that — the
    medium offset, or nothing — and the finger's `drag` is on top of it. A
    ref beside each, because the responder is created once and reads them.
  */
  const window = useWindowDimensions();
  const detent = useRef(new Animated.Value(0)).current;
  const detentRef = useRef(0);
  const [at, setAt] = useState<Detent>('medium');
  const atRef = useRef<Detent>('medium');
  const offsetRef = useRef(0);
  const offset = expand && sheetHeight > 0 ? mediumOffset(sheetHeight, window.height) : 0;
  offsetRef.current = offset;

  const { mounted, progress } = useOverlayPresence(visible, reduceMotion, (value) => {
    // From nothing each time, or a sheet dismissed by a swipe reopens already
    // pushed off-screen.
    drag.setValue(0);
    return Animated.timing(value, {
      toValue: 1,
      // `sheet`, not `base`: the largest surface the app moves, and the one
      // whose old duration was measured reading as a pop. See `motion.sheet`.
      duration: reduceMotion ? 0 : motion.sheet,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
  });

  // The web Modal is a portal next to #root. Keep that root inert for the
  // complete enter/exit animation so keyboard focus cannot slip behind it.
  useInertAppRoot(mounted);
  useReturnFocus(mounted);



  /**
   * How tall the sheet is, measured once per opening.
   *
   * **The travel distance may not change while the sheet is travelling**, and
   * it did. `sheetHeight` starts at 0, so the first frame interpolates against
   * `ESTIMATED_HEIGHT` — 320 — and the add-piece sheet is around 460. Layout
   * arrives a frame or two later, the output range widens under the running
   * animation, and the sheet jumps *down* a hundred points before rising: a
   * visible hitch at the start of every sheet in the app, which is most of
   * what "it just pops up instead of having like an animation" describes.
   *
   * So the height is taken once and then left alone until the sheet closes,
   * and the sheet is transparent until it has one — one frame of nothing
   * rather than one frame of the wrong place. `visible` clears it, not
   * `mounted`: `mounted` stays true through the exit, and clearing it there
   * would take the sheet's height away mid-departure.
   */
  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    if (heightRef.current > 0 || next <= 0) {
      return;
    }
    heightRef.current = next;
    setSheetHeight(next);
    // A long sheet arrives at its medium height, every time it opens.
    const rest = expand ? mediumOffset(next, window.height) : 0;
    detent.setValue(rest);
    detentRef.current = rest;
    atRef.current = 'medium';
    setAt('medium');
  }

  /** Settle a long sheet at one of its heights, from wherever it is now. */
  function settleAt(target: Detent, from: number, vy = 0) {
    const to = target === 'large' ? 0 : offsetRef.current;
    detent.setValue(from);
    drag.setValue(0);
    detentRef.current = to;
    atRef.current = target;
    setAt(target);
    if (reduceMotion) {
      detent.setValue(to);
      return;
    }
    Animated.spring(detent, {
      toValue: to,
      useNativeDriver: Platform.OS !== 'web',
      ...SPRING,
      velocity: settleVelocity(vy, { from, to }),
    }).start();
  }

  useEffect(() => {
    if (!visible) {
      heightRef.current = 0;
      setSheetHeight(0);
    }
  }, [visible]);

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
          drag.setValue(
            offsetRef.current > 0
              ? detentDragOffset(gesture.dy, atRef.current, offsetRef.current)
              : dragOffset(gesture.dy),
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          const height = heightRef.current;
          const vy = velocityFrom(samplesRef.current);
          samplesRef.current = [];
          const from = dragOffset(gesture.dy);
          // A long sheet settles at a height unless the drag closes it.
          const detented =
            offsetRef.current > 0
              ? settleDetent({
                  at: atRef.current,
                  dy: gesture.dy,
                  vy,
                  offset: offsetRef.current,
                  height,
                })
              : null;
          if (detented === 'large' || detented === 'medium') {
            settleAt(
              detented,
              detentRef.current +
                detentDragOffset(gesture.dy, atRef.current, offsetRef.current),
              vy,
            );
            return;
          }
          if (detented === 'dismiss' || shouldDismiss({ dy: gesture.dy, vy, height })) {
            const to = height || ESTIMATED_HEIGHT;
            // Carry the sheet the rest of the way, then hand over. Snapping
            // back to closed would throw away the continuity the drag just
            // established.
            //
            // **A spring rather than the fixed-duration timing this used to
            // be.** A duration cannot know how hard the sheet was thrown, so a
            // hard flick and a slow shove took the same 200ms and the moment
            // the finger lifted the sheet stopped being thrown and started
            // being played back. The spring takes the release velocity and
            // continues at exactly the speed the finger left it at.
            if (reduceMotion) {
              drag.setValue(to);
              onClose();
              return;
            }
            Animated.spring(drag, {
              toValue: to,
              useNativeDriver: Platform.OS !== 'web',
              ...SPRING,
              velocity: settleVelocity(vy, { from, to }),
              // It is leaving. Letting it overshoot past the bottom edge costs
              // nothing visible, where clamping makes a fast flick decelerate
              // into the edge it is supposed to be flying through.
              overshootClamping: false,
            }).start();
            /*
              **Closed on release, not when the spring settles.** `onClose`
              waited for this spring's `finished`, and a spring's long settle
              is most of a second after the sheet has left the screen: the
              app root stayed `inert` until 1,341ms after a swipe, against
              195ms for ✕, so the next tap on the page did nothing (measured,
              2026-11-12). The sheet is gone as far as a thumb can tell the
              moment it is let go. The spring carries on as the exit, and
              `useInertAppRoot` still holds the root until the presence's own
              exit ends, exactly as it does for ✕.
            */
            onClose();
            return;
          }
          Animated.spring(drag, {
            toValue: 0,
            useNativeDriver: Platform.OS !== 'web',
            ...SPRING,
            velocity: settleVelocity(vy, { from, to: 0 }),
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
    // `settleAt` reads only refs and stable values, so the responder made once
    // stays right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drag, onClose, reduceMotion],
  );

  /*
    **The screen behind, pushed back into a card** (`lib/motion/recede.ts`).
    A long sheet does it as it rises from medium to the full height — none at
    medium, all of it at the top, following the finger between — which is
    UIKit's page sheet. A content-sized sheet does it only when it is tall,
    with its rise and its drag, as the scrim fades.
  */
  const recedeDriver = useMemo(() => {
    if (offset > 0) {
      return Animated.multiply(
        progress,
        Animated.add(detent, drag).interpolate({
          inputRange: [0, offset],
          outputRange: [1, 0],
          extrapolate: 'clamp',
        }),
      );
    }
    return Animated.multiply(
      progress,
      drag.interpolate({
        inputRange: [0, sheetHeight || ESTIMATED_HEIGHT],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      }),
    );
  }, [detent, drag, offset, progress, sheetHeight]);
  useRecede(
    recedeDriver,
    mounted && sheetHeight > 0 && (offset > 0 || recedesBehind(sheetHeight, window.height)),
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
          {/* Pointer dismissal only, and unfocusable: see `DismissArea`. */}
          <DismissArea onDismiss={onClose} />
        </Animated.View>

        <Animated.View
          onLayout={handleLayout}
          style={[
            styles.sheet,
            expand && [styles.expanded, { marginTop: insets.top + spacing.xl }],
            { paddingBottom: insets.bottom + spacing.lg },
            {
              // Nothing to see until it is known where the sheet is — see
              // `handleLayout`. One frame, and never more than a few.
              opacity: sheetHeight > 0 ? 1 : 0,
              transform: [{ translateY: Animated.add(Animated.add(enterOffset, drag), detent) }],
            },
          ]}
        >
          {/*
            The grab area: the handle and the title row together, so the target
            is a comfortable strip rather than a 4pt bar.
          */}
          <View {...pan.panHandlers} style={GRAB_AREA_WEB}>
            {offset > 0 ? (
              /*
                **The grab bar of a long sheet also answers a tap**, as UIKit's
                does: it takes the sheet to its other height.
              */
              <Pressable
                onPress={() => settleAt(at === 'medium' ? 'large' : 'medium', detentRef.current)}
                accessibilityRole="button"
                accessibilityLabel={at === 'medium' ? 'Show more' : 'Show less'}
                style={styles.handleTarget}
              >
                <View style={styles.handle} />
              </Pressable>
            ) : (
              <View style={styles.handle} />
            )}

            {title || showClose ? (
              <View style={styles.header}>
                {title ? (
                  <Text variant="sheetTitle" style={styles.title}>
                    {title}
                  </Text>
                ) : null}
                {showClose ? (
                  <IconButton icon={X} label="Close" onPress={onClose} />
                ) : null}
              </View>
            ) : null}
          </View>

          {/*
            `expand` sheets fill the screen and their body scrolls, so their
            drag stays on the grab area — a `PanResponder` competing with a
            `ScrollView` for the same touch is how a list stops scrolling.
            Short sheets have nothing to scroll, so all of them drags.
          */}
          {expand ? (
            // At medium, the list ends where the sheet does on screen rather
            // than under the bottom edge, so its last rows can be scrolled to.
            <View style={[styles.body, { paddingBottom: at === 'medium' ? offset : 0 }]}>
              {children}
            </View>
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
  /*
    **The redesign's sheet** (2026-09-23): the page's own ivory rather than a
    white card, the larger `sheet` curve, and no top rule — over the scrim the
    ground change is the edge.
  */
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing['2xl'],
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
  // A touch target round the bar, at the floor's height, in the strip that
  // already took the drag.
  handleTarget: {
    alignSelf: 'center',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET * 2,
    marginVertical: -(MIN_TOUCH_TARGET - spacing.xs) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    // `borderStrong`: on ivory, `border` all but vanishes, and a handle nobody
    // can see is not an affordance.
    backgroundColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  title: {
    flex: 1,
  },
});
