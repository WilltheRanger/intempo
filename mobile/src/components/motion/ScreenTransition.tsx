import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { colors, EASE_OUT, motion, SPRING } from '../../design';
import {
  isPopGesture,
  popOffset,
  SCRIM_OPACITY,
  shouldPop,
  startsAtEdge,
} from '../../lib/motion/screenTransition';
import { trimSamples, velocityFrom, type DragSample } from '../../lib/motion/sheetDrag';
import { useReducedMotion } from '../../lib/useReducedMotion';

export interface ScreenTransitionProps {
  children: ReactNode;
  /**
   * Which edge the screen comes from. `bottom` is for a screen presented over
   * everything rather than pushed onto the stack — the camera — and it carries
   * no back gesture, because a presented screen's dismissal is its own control.
   */
  from?: 'right' | 'bottom';
}

/** Travel distance before layout has measured the screen. */
const ESTIMATED_WIDTH = 393;

/**
 * The push and pop a browser does not do for itself.
 *
 * **Web only, and a pass-through everywhere else.** On iOS
 * `@react-navigation/native-stack` hands the push to `UINavigationController`,
 * so the slide, the parallax and the interactive swipe-back are Apple's own.
 * Measured on the built bundle: in a browser, pushing a screen produced 3
 * distinct frames out of 35 sampled and going back produced 1 — a hard cut in
 * both directions, on every navigation in the app.
 *
 * Three exits, one animation. The back control, the swipe, and a browser's own
 * back button all leave through React Navigation's `beforeRemove`, which is
 * intercepted once here: the removal is held, the screen is animated off, and
 * the original action is dispatched afterwards. Animating only the gesture
 * would have left the back *button* — which is how most people leave a screen —
 * cutting exactly as it does today.
 *
 * **The gesture is `PanResponder`**, for the reason `sheetDrag` gives: there is
 * no gesture library in this app, and adding one is a native rebuild. It is
 * claimed only for a touch that begins in the 20pt strip along the left edge
 * and then moves rightward more than vertically — the score scrolls sideways
 * and every screen scrolls down, and both must win their own gestures.
 *
 * The rules and thresholds live in `lib/motion/screenTransition.ts` with tests,
 * because there is no React Native testing library here (`CLAUDE.md` §3).
 */
export function ScreenTransition({ children, from = 'right' }: ScreenTransitionProps) {
  if (Platform.OS !== 'web') {
    // UIKit already does all of this, and better. Rendering a second animated
    // container over it would fight the real transition, not add to it.
    return <>{children}</>;
  }
  return <WebScreenTransition from={from}>{children}</WebScreenTransition>;
}

function WebScreenTransition({ children, from }: Required<ScreenTransitionProps>) {
  const navigation = useNavigation();
  const reduceMotion = useReducedMotion();
  /** 0 = fully off-screen, 1 = arrived. */
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const [size, setSize] = useState({ width: 0, height: 0 });
  /**
   * Whether a transition is in flight, and therefore whether the scrim exists
   * in the tree at all.
   *
   * **It used to be rendered always, and that was wrong twice over.** At rest
   * it is a full-screen ink fill sitting behind an opaque screen: invisible,
   * and pure cost on every screen in the app. It also made `audit-a11y.mjs`
   * report 414 contrast failures — a covering absolutely-positioned sibling is
   * exactly the shape of a glass layer painted *over* content, which is what
   * that check is for, and the audit had no way to tell the two apart. The
   * first fix attempted was to teach the audit the difference; it silenced the
   * glass check it was written for, caught by mutation-testing it. Removing
   * the thing when it has no job is smaller, faster and needs nothing from the
   * check.
   */
  const [transitioning, setTransitioning] = useState(!reduceMotion);
  // Read inside the responder, which is built once and would otherwise close
  // over the width as it was on the first render — zero.
  const widthRef = useRef(0);
  const samplesRef = useRef<DragSample[]>([]);
  /** Set once the exit has been let through, so `beforeRemove` does not loop. */
  const leaving = useRef(false);

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    setTransitioning(true);
    const animation = Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: false,
      ...SPRING,
    });
    animation.start(({ finished }) => {
      if (finished) {
        setTransitioning(false);
      }
    });
    return () => animation.stop();
  }, [progress, reduceMotion]);

  /**
   * Hold every removal long enough to animate it.
   *
   * `beforeRemove` fires for the back control, the swipe, the browser's back
   * button and a programmatic `goBack` alike, which is why the exit lives here
   * rather than in each of them. The guard is what stops the re-dispatch from
   * being intercepted again.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (leaving.current || reduceMotion) {
        return;
      }
      event.preventDefault();
      leaving.current = true;
      setTransitioning(true);
      Animated.timing(progress, {
        toValue: 0,
        duration: motion.scene,
        easing: EASE_OUT,
        useNativeDriver: false,
      }).start(() => navigation.dispatch(event.data.action));
    });
    return unsubscribe;
  }, [navigation, progress, reduceMotion]);

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    widthRef.current = width;
    setSize({ width, height });
  }

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Never on touch-down: a screen that claims the touch before it has
        // moved eats the first tap on anything near the left margin.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (event, gesture) =>
          from === 'right' &&
          navigation.canGoBack() &&
          startsAtEdge(event.nativeEvent.pageX - gesture.dx) &&
          isPopGesture(gesture.dx, gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          setTransitioning(true);
          const width = widthRef.current || ESTIMATED_WIDTH;
          const now = Date.now();
          samplesRef.current = trimSamples(
            // `dy` on the sample is the travel being measured, which here is
            // horizontal. One velocity helper, two axes.
            [...samplesRef.current, { dy: gesture.dx, t: now }],
            now,
          );
          progress.setValue(1 - popOffset(gesture.dx) / width);
        },
        onPanResponderRelease: (_event, gesture) => {
          const width = widthRef.current;
          const vx = velocityFrom(samplesRef.current);
          samplesRef.current = [];
          if (shouldPop({ dx: gesture.dx, vx, width })) {
            // Straight to `goBack`: `beforeRemove` picks it up and carries the
            // screen the rest of the way from wherever the finger left it.
            navigation.goBack();
            return;
          }
          Animated.spring(progress, {
            toValue: 1,
            useNativeDriver: false,
            ...SPRING,
          }).start(({ finished }) => finished && setTransitioning(false));
        },
        onPanResponderTerminate: () => {
          samplesRef.current = [];
          Animated.spring(progress, {
            toValue: 1,
            useNativeDriver: false,
            ...SPRING,
          }).start(({ finished }) => finished && setTransitioning(false));
        },
      }),
    [from, navigation, progress],
  );

  const travel =
    from === 'right' ? size.width || ESTIMATED_WIDTH : size.height || ESTIMATED_WIDTH;
  const offset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [travel, 0],
    // The spring overshoots past 1; without clamping, the screen would pull a
    // few points past its own edge on arrival.
    extrapolate: 'clamp',
  });
  const scrim = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCRIM_OPACITY],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {/*
        Depth, standing in for the screen iOS dims and slides away underneath.
        `react-native-screens` sets `display: none` on that screen the moment
        the push commits — measured — so there is nothing there to move.
      */}
      {transitioning ? (
        <Animated.View style={[styles.scrim, { opacity: scrim }]} pointerEvents="none" />
      ) : null}

      <Animated.View
        style={[
          styles.screen,
          { transform: [from === 'right' ? { translateX: offset } : { translateY: offset }] },
        ]}
        {...(from === 'right' ? pan.panHandlers : {})}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Clips the screen while it is off to the side. Without this a screen
    // waiting at `translateX: width` extends the document, and the page itself
    // becomes horizontally scrollable into empty space for the length of every
    // transition — measured at 490px of scroll width against a 393px viewport.
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.textPrimary,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    /**
     * Above the scrim, said out loud.
     *
     * A transform creates a stacking context, so the browser already paints
     * this over the absolutely-positioned scrim behind it — verified in
     * pixels: the settled screen reads #F7F2E9 with #14110E text, full
     * contrast. But that is an *implicit* rule, and `audit-a11y.mjs` read the
     * markup the other way and reported 414 contrast failures across every
     * pushed screen. The third time this codebase has leaned on paint order
     * without declaring it, after `GlassSurface` and `ConfirmDialog`.
     *
     * The audit was not loosened to accept it. Depending on which of two
     * elements a browser happens to paint first is the bug; one line saying
     * which one wins is the fix.
     */
    zIndex: 1,
  },
});
