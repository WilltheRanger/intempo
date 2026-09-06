import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, motion, SPRING_CSS } from '../../design';
import {
  isPopGesture,
  popOffset,
  SCRIM_OPACITY,
  scrimOpacity,
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
 * **The motion is CSS, not `Animated`, and that is the whole point.** The first
 * version drove an `Animated.Value` with `useNativeDriver: false`, which is the
 * JavaScript thread — the same thread React is on while it mounts the screen
 * being pushed. Recorded frame by frame: the screen slid from 393 to 329, then
 * **no frames at all for 326ms**, then reappeared at 157 and finished. It
 * stalled mid-slide and jumped, which is exactly what "glitchy and flickery"
 * describes. A CSS transition is handed to the compositor and keeps running
 * while the main thread is busy, so the slide is smooth *because* it is no
 * longer JavaScript's job. `FadeIn` had already learned this and says so; this
 * component did not follow it.
 *
 * **The arrival is a keyframe animation, not a transition, and that is the
 * second fix.** A transition needs its start state painted and then a *second*
 * JavaScript step to set the destination — `requestAnimationFrame`, which
 * cannot run until React has finished mounting the screen. Recorded from the
 * compositor: the outgoing screen is hidden in the same commit that mounts the
 * new one, so for the whole of that wait the viewport was **uniform
 * #F7F2E9 — a blank sheet of paper, for about 190ms, on every push.** That is
 * the flicker. A keyframe animation set in the ref callback needs no second
 * step: it is running the moment the element is first painted, so there is no
 * frame in which the screen exists and is not yet moving.
 *
 * The transform is written straight to the node rather than rendered from
 * state. Two reasons: an off-screen start has to be in place before the first
 * paint or the screen appears in position and then jumps, and a React render
 * per frame is the thing being avoided in the first place. So `Animated` is
 * gone entirely — the drag writes the same property the animation leaves
 * behind, with both switched off for as long as a finger is down.
 *
 * Three exits, one animation. The back control, the swipe, and a browser's own
 * back button all leave through React Navigation's `beforeRemove`, intercepted
 * once here: the removal is held, the screen is animated off, and the original
 * action is dispatched afterwards. Animating only the gesture would have left
 * the back *button* — which is how most people leave a screen — cutting exactly
 * as it did before.
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

/** The resting transform, and the one a screen waits at and leaves to. */
const AT_REST = 'translate3d(0, 0, 0)';
const offStage = (from: 'right' | 'bottom') =>
  from === 'right' ? 'translate3d(100%, 0, 0)' : 'translate3d(0, 100%, 0)';

const STYLE_ID = 'intempo-screen-transition';

/**
 * Adds the arrival keyframes to the document once.
 *
 * Injected from here rather than written into `public/index.html` for the
 * reason `lensFilter.ts` gives about that file: it carries the boot watchdog,
 * its inline script is content-hashed into the Content-Security-Policy at
 * build time, and a test evaluates it. Two keyframe rules are not worth
 * touching any of that.
 */
function installKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
@keyframes intempo-push-right {
  from { transform: translate3d(100%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}
@keyframes intempo-push-bottom {
  from { transform: translate3d(0, 100%, 0); }
  to { transform: translate3d(0, 0, 0); }
}
@keyframes intempo-push-scrim {
  from { opacity: 0; }
  to { opacity: ${SCRIM_OPACITY}; }
}`;
  document.head.appendChild(style);
}

function WebScreenTransition({ children, from }: Required<ScreenTransitionProps>) {
  const navigation = useNavigation();
  const reduceMotion = useReducedMotion();
  /**
   * Whether the scrim is in the tree at all.
   *
   * **Not an optimisation.** Left there at rest it is a full-screen ink fill
   * behind an opaque screen — invisible, and to a static reader of the DOM
   * indistinguishable from a glass layer painted *over* content, which is what
   * `audit-a11y.mjs` exists to find. It reported 414 contrast failures on text
   * that measures at full contrast in pixels. Removing the element when it has
   * no job needs nothing from the check.
   */
  const [transitioning, setTransitioning] = useState(!reduceMotion);
  const screenRef = useRef<HTMLElement | null>(null);
  const scrimRef = useRef<HTMLElement | null>(null);
  const widthRef = useRef(0);
  const samplesRef = useRef<DragSample[]>([]);
  /** Set once the exit has been let through, so `beforeRemove` does not loop. */
  const leaving = useRef(false);

  /**
   * Puts the screen off-stage synchronously, before the browser paints it.
   *
   * A ref callback runs during commit; an effect runs after paint. Starting
   * from an effect showed the screen in position for one frame and then
   * snapped it off-stage to begin — a flash on every push.
   */
  const attach = useCallback(
    (node: unknown) => {
      const element = node as HTMLElement | null;
      screenRef.current = element;
      if (!element || reduceMotion || element.dataset.arriving) {
        return;
      }
      installKeyframes();
      element.dataset.arriving = 'true';
      element.style.animation =
        `intempo-push-${from} ${motion.spring}ms ${SPRING_CSS} both`;
      // `both` holds the final frame, and a held animation outranks any later
      // inline transform — which is what the drag and the exit both set. So the
      // animation hands the transform over the moment it is done with it.
      element.addEventListener(
        'animationend',
        () => {
          element.style.animation = 'none';
          element.style.transform = AT_REST;
        },
        { once: true },
      );
    },
    [from, reduceMotion],
  );

  const attachScrim = useCallback(
    (node: unknown) => {
      const element = node as HTMLElement | null;
      scrimRef.current = element;
      if (!element || reduceMotion || element.dataset.arriving) {
        return;
      }
      installKeyframes();
      element.dataset.arriving = 'true';
      element.style.animation =
        `intempo-push-scrim ${motion.spring}ms ${SPRING_CSS} both`;
      element.addEventListener(
        'animationend',
        () => {
          element.style.animation = 'none';
          element.style.opacity = String(SCRIM_OPACITY);
        },
        { once: true },
      );
    },
    [reduceMotion],
  );

  /**
   * Hand the element back to transitions and move it.
   *
   * Clearing `animation` first is load-bearing: an arrival still holding its
   * final frame outranks an inline transform, so a swipe begun during the push
   * would move nothing at all.
   */
  const settle = useCallback((to: string, opacity: number) => {
    const screen = screenRef.current;
    if (screen) {
      screen.style.animation = 'none';
      screen.style.transitionDuration = `${motion.spring}ms`;
      screen.style.transform = to;
    }
    const scrim = scrimRef.current;
    if (scrim) {
      scrim.style.animation = 'none';
      scrim.style.transitionDuration = `${motion.spring}ms`;
      scrim.style.opacity = String(opacity);
    }
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    // Nothing is scheduled here any more — the arrival is already running,
    // started in the ref callback before this effect existed. This only takes
    // the scrim back out once the screen has landed.
    const done = setTimeout(() => {
      setTransitioning(false);
      // Stop paying for a promoted layer on a screen that has stopped moving.
      if (screenRef.current) {
        screenRef.current.style.willChange = 'auto';
      }
    }, motion.spring + 40);
    return () => clearTimeout(done);
  }, [reduceMotion]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (leaving.current || reduceMotion) {
        return;
      }
      event.preventDefault();
      leaving.current = true;
      setTransitioning(true);
      if (screenRef.current) {
        screenRef.current.style.willChange = 'transform';
      }
      settle(offStage(from), 0);
      setTimeout(() => navigation.dispatch(event.data.action), motion.spring);
    });
    return unsubscribe;
  }, [from, navigation, reduceMotion, settle]);

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
        onPanResponderGrant: () => {
          setTransitioning(true);
          widthRef.current = screenRef.current?.offsetWidth ?? 0;
          // The finger owns the transform now, so the transition must not also
          // be interpolating it — that is what makes a drag feel like it is
          // catching up with itself rather than following.
          for (const node of [screenRef.current, scrimRef.current]) {
            if (node) {
              node.style.animation = 'none';
              node.style.transitionDuration = '0ms';
              node.style.willChange = 'transform, opacity';
            }
          }
        },
        onPanResponderMove: (_event, gesture) => {
          const width = widthRef.current || 1;
          const now = Date.now();
          samplesRef.current = trimSamples(
            // `dy` on the sample is the travel being measured, which here is
            // horizontal. One velocity helper, two axes.
            [...samplesRef.current, { dy: gesture.dx, t: now }],
            now,
          );
          const travelled = popOffset(gesture.dx);
          if (screenRef.current) {
            screenRef.current.style.transform = `translate3d(${travelled}px, 0, 0)`;
          }
          if (scrimRef.current) {
            scrimRef.current.style.opacity = String(scrimOpacity(1 - travelled / width));
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          const vx = velocityFrom(samplesRef.current);
          samplesRef.current = [];
          if (shouldPop({ dx: gesture.dx, vx, width: widthRef.current })) {
            // `beforeRemove` picks this up and carries the screen the rest of
            // the way from wherever the finger left it.
            navigation.goBack();
            return;
          }
          settle(AT_REST, SCRIM_OPACITY);
        },
        onPanResponderTerminate: () => {
          samplesRef.current = [];
          settle(AT_REST, SCRIM_OPACITY);
        },
      }),
    [from, navigation, settle],
  );

  return (
    <View style={styles.container}>
      {/*
        Depth, standing in for the screen iOS dims and slides away underneath.
        `react-native-screens` sets `display: none` on that screen the moment
        the push commits — measured — so there is nothing there to move.
      */}
      {transitioning ? (
        <View ref={attachScrim} style={[styles.scrim, transition('opacity')]} pointerEvents="none" />
      ) : null}

      <View
        ref={attach}
        style={[styles.screen, transition('transform')]}
        {...(from === 'right' ? pan.panHandlers : {})}
      >
        {children}
      </View>
    </View>
  );
}

/** The CSS half of the animation. Web-only, so these land as written. */
function transition(property: 'transform' | 'opacity'): ViewStyle {
  return {
    transitionProperty: property,
    transitionDuration: `${motion.spring}ms`,
    transitionTimingFunction: SPRING_CSS,
    willChange: property,
  } as unknown as ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Clips the screen while it is off to the side. Without this a screen
    // waiting at 100% extends the document, and the page itself becomes
    // horizontally scrollable into empty space for the length of every
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
    opacity: 0,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    /**
     * Safari's flicker guard on a 3D-transformed layer.
     *
     * `translate3d` promotes this to its own compositor layer, and WebKit is
     * known to flash the back face of such a layer at the start and end of an
     * animation — the classic symptom being a one-frame blank or white flash
     * on exactly this kind of screen transition. Hiding the back face is the
     * standard fix and costs nothing on a surface that is never rotated.
     *
     * **Not verified here.** There is no Safari in this environment; this
     * environment is headless Chromium on a software rasterizer, which does
     * not reproduce the bug and cannot confirm the fix. Added on the strength
     * of the platform behaviour and a report of flickering from an iPhone.
     */
    backfaceVisibility: 'hidden',
    ...({ WebkitBackfaceVisibility: 'hidden' } as object),
  },
});
