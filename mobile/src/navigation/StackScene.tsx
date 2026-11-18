import {
  useIsFocused,
  useNavigation,
  useNavigationState,
  useRoute,
} from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, motion, SLIDE_EASE_CSS } from '../design';
import { useReducedMotion } from '../lib/useReducedMotion';
import { stackChangeAnimatedByBrowser } from './browserBack';
import {
  clearExitDrawn,
  exitJustDrawn,
  markExitDrawn,
  noteStackLength,
  onUnderRequest,
  requestUnder,
  SceneExitContext,
  settledStackLength,
} from './sceneExit';
import { OFF_TRAILING, REST, UNDER, planFor, poseTransform, type Pose } from './sceneMotion';

/**
 * A screen of the stack, moving the way an iPhone moves it — on the build
 * where nothing else draws it.
 *
 * **Native renders its children and stops.** `native-stack` hands the push to
 * UINavigationController there and gets the platform's own transition, with
 * the back gesture attached to it. Layering a second animation over it would
 * fight it.
 *
 * **The web build gets the iOS slide** (2026-11-13). The screen pushed slides
 * in across the whole width; the one it covers drifts a third of the way
 * under it and dims, and stops being drawn when the slide ends. Back reverses
 * it: an in-app back slides the screen in front out and brings the one under
 * it back before the pop (`sceneExit.ts`), and a screen returned to any other
 * way — the browser's button, a `popTo` after a save — comes back from under.
 * Safari's own swipe back has drawn its change already and is left alone
 * (`browserBack.ts`). The rules, and why a screen being left can stay drawn at
 * all, are in `sceneMotion.ts`.
 *
 * ## The start state is painted first, not reached backwards
 *
 * A screen that was not drawn has no previous computed style, so the first
 * frame it is drawn in *is* its start — a CSS transition declared on it has
 * nothing to interpolate from and the browser paints the end state. So the
 * plan is decided during render, in React's own adjust-state-when-the-input-
 * changes shape: the stack index this scene last saw is state, and a scene
 * that notices the stack has moved re-renders *before painting* with its start
 * pose applied. The two `requestAnimationFrame`s after it are the other half —
 * one frame to paint the start, one to hand over the destination.
 *
 * Opacity and transform only, so the compositor carries it without laying the
 * screen out again on every frame.
 */
export function StackScene({ children }: { children: ReactNode }) {
  // Every hook runs on both platforms — a hook below an early return is React
  // error #310, which this project has shipped (`CLAUDE.md` §1, convention 4).
  const focused = useIsFocused();
  const route = useRoute();
  const navigation = useNavigation();
  /*
    Selected rather than the whole state: React Navigation re-renders this
    only on a change to a selected value, and `children` is the same element
    across those renders, so the screen itself is not re-rendered with it.
  */
  const index = useNavigationState((state) => state.index);
  const length = useNavigationState((state) => state.routes.length);
  const own = useNavigationState((state) =>
    state.routes.findIndex((candidate) => candidate.key === route.key),
  );
  const reduceMotion = useReducedMotion();
  const still = Platform.OS !== 'web' || reduceMotion;

  /** The stack index this scene last saw — see `planFor` on why not focus. */
  const [seen, setSeen] = useState<number | null>(null);
  /** Where the scene is drawn. */
  const [pose, setPose] = useState<Pose>(REST);
  /** Whether the pose is being transitioned to, or set outright. */
  const [moving, setMoving] = useState(false);
  /** A destination to hand over once the start pose has been painted. */
  const [next, setNext] = useState<Pose | null>(null);
  /** Not drawn at all: under the stack, where nobody can see it. */
  const [hidden, setHidden] = useState(false);
  /** Stop drawing once the slide to `next` has finished. */
  const [hideAfter, setHideAfter] = useState(false);

  if (seen !== index) {
    // Render-phase, deliberately: this has to be the state the browser paints
    // first, and an effect is a frame too late. React re-renders immediately
    // and discards the output above, so nothing is committed twice.
    const plan = planFor({
      seen,
      index,
      own,
      settledLength: settledStackLength(),
      length,
      drawnAlready: still || stackChangeAnimatedByBrowser() || exitJustDrawn(),
    });
    setSeen(index);
    setMoving(false);
    switch (plan.kind) {
      case 'arrive':
        setHidden(false);
        setPose(plan.from);
        setNext(REST);
        setHideAfter(false);
        break;
      case 'cover':
        setHidden(false);
        setPose(REST);
        setNext(UNDER);
        setHideAfter(true);
        break;
      case 'rest':
        setHidden(false);
        setPose(REST);
        setNext(null);
        setHideAfter(false);
        break;
      case 'hidden':
        setHidden(true);
        setPose(REST);
        setNext(null);
        setHideAfter(false);
        break;
    }
  }

  // The stack has settled at this length, for the next scene that appears
  // to tell a push from a replace (`sceneExit.noteStackLength`).
  useEffect(() => {
    noteStackLength(length);
  }, [length]);

  // One frame to paint the start, one to hand over the destination: a
  // zero-delay timeout is coalesced into the first paint and skips the slide.
  useEffect(() => {
    if (next === null) {
      return undefined;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setMoving(true);
        setPose(next);
        setNext(null);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) {
        cancelAnimationFrame(second);
      }
    };
  }, [next]);

  // A covered scene stops being drawn once it is under: a full screen that
  // nobody can see is a full screen the browser still paints.
  useEffect(() => {
    if (!hideAfter || !moving || next !== null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setHidden(true);
      setMoving(false);
      setHideAfter(false);
    }, motion.push);
    return () => clearTimeout(timer);
  }, [hideAfter, moving, next]);

  // The scene in front sliding out asks this one, under it, to come back
  // from under — or, if something held the pop, to go back under.
  useEffect(() => {
    if (still) {
      return undefined;
    }
    return onUnderRequest((target, request) => {
      if (target !== own) {
        return;
      }
      setHidden(false);
      setMoving(false);
      if (request === 'reveal') {
        setPose(UNDER);
        setNext(REST);
        setHideAfter(false);
      } else {
        setPose(REST);
        setNext(UNDER);
        setHideAfter(true);
      }
    });
  }, [own, still]);

  const exiting = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const exit = useCallback(
    (then: () => void) => {
      // A second press while the first is still sliding out is the same back.
      if (exiting.current) {
        return;
      }
      if (still || own <= 0 || !focused) {
        then();
        return;
      }
      exiting.current = true;
      setMoving(true);
      setNext(null);
      setPose(OFF_TRAILING);
      requestUnder(own - 1, 'reveal');
      setTimeout(() => {
        markExitDrawn();
        then();
        /*
          **Held back, and come back.** A screen can refuse to be left —
          Record asks before a take in progress is thrown away — and then the
          pop did nothing and this screen is still here, off the trailing edge.
          A frame later, so a pop that did happen has unmounted it first: only
          a screen that is still mounted and still in the stack slides back in
          front, and only then does the one it revealed go back under.
        */
        requestAnimationFrame(() => {
          exiting.current = false;
          if (!mounted.current) {
            return;
          }
          if (!navigation.getState()?.routes.some((candidate) => candidate.key === route.key)) {
            return;
          }
          clearExitDrawn();
          setMoving(true);
          setPose(REST);
          requestUnder(own - 1, 'cover');
        });
      }, motion.push);
    },
    [focused, navigation, own, route.key, still],
  );

  if (Platform.OS !== 'web') {
    return <View style={styles.scene}>{children}</View>;
  }

  const inFront = focused && !exiting.current;
  const drawn = !(pose === REST && !moving && next === null);
  return (
    <SceneExitContext.Provider value={exit}>
      <View
        style={[styles.scene, sceneStyle(pose, moving, hidden)]}
        pointerEvents={inFront ? 'auto' : 'none'}
        // A screen under the one in front is never what a screen reader is
        // reading, nor what the browser's title or the focus on arrival is
        // looking for (`documentTitle.ts`, `screenFocus.ts`).
        aria-hidden={!focused}
      >
        {children}
        {/*
          **The dim is drawn only while a scene is moving or under**, and that
          is not an optimisation: left in the tree at rest it is a full-screen
          ink fill behind an opaque screen, which `audit-a11y.mjs` reads as a
          layer painted over content (`DECISIONS.md`, 2026-09-06).
        */}
        {drawn ? (
          <View pointerEvents="none" aria-hidden style={[styles.dim, dimStyle(pose, moving)]} />
        ) : null}
      </View>
    </SceneExitContext.Provider>
  );
}

/** A pose as inline CSS the compositor can run. */
function sceneStyle(pose: Pose, moving: boolean, hidden: boolean): ViewStyle {
  return {
    display: hidden ? 'none' : 'flex',
    opacity: pose.opacity,
    transform: poseTransform(pose),
    transitionProperty: 'opacity, transform',
    transitionDuration: moving ? `${motion.push}ms` : '0ms',
    transitionTimingFunction: SLIDE_EASE_CSS,
    willChange: moving ? 'opacity, transform' : 'auto',
  } as unknown as ViewStyle;
}

function dimStyle(pose: Pose, moving: boolean): ViewStyle {
  return {
    opacity: pose.dim,
    transitionProperty: 'opacity',
    transitionDuration: moving ? `${motion.push}ms` : '0ms',
    transitionTimingFunction: SLIDE_EASE_CSS,
  } as unknown as ViewStyle;
}

const styles = StyleSheet.create({
  scene: {
    flex: 1,
    // The card is opaque whatever the screen draws: the screen under it stays
    // drawn while this one crosses it, and must not show through.
    backgroundColor: colors.bg,
  },
  dim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.textPrimary,
  },
});
