import { useIsFocused, useNavigationState } from '@react-navigation/native';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { motion } from '../design';
import { useReducedMotion } from '../lib/useReducedMotion';
import { sceneDirection, sceneOffset, type SceneDirection } from './sceneMotion';

/**
 * A pushed screen arriving, on the build where nothing else draws one.
 *
 * **Native renders its children and stops.** `native-stack` hands the push to
 * UINavigationController there and gets the platform's own transition — the
 * outgoing screen sliding out under the incoming one, interruptible, with the
 * back gesture attached to it. Nothing written here could improve on that, and
 * layering a second animation over it would fight it.
 *
 * The web build gets none of that: `react-native-screens` is a stub there, and
 * `NativeStackView` gives the focused screen `display: 'flex'` and every other
 * one `display: 'none'`. A push is one frame. `sceneMotion.ts` has the details
 * and the direction rule; this is the movement.
 *
 * ## The start state is painted first, not reached backwards
 *
 * A `display: none` element has no previous computed style, so the first frame
 * after it becomes visible *is* its start — a CSS transition declared on it has
 * nothing to interpolate from and the browser paints the end state.
 *
 * The first attempt at this held the arrived state in `useState(true)` and
 * pushed it back to false from an effect. It never animated: measured on the
 * built bundle, sampling every frame from the tap, the pushed scene was at
 * opacity 1 and zero offset on the *first* frame it existed and stayed there.
 * An effect runs after the commit it belongs to, and the update it schedules
 * competes with the two animation frames meant to follow it.
 *
 * So the entrance is decided during render, in React's own
 * adjust-state-when-the-input-changes shape: the index this scene last saw is
 * state, and a scene that notices the stack has moved re-renders *before
 * painting* with the offset already applied. `FadeIn` starts from its hidden
 * state on this platform for the same reason. The two `requestAnimationFrame`s
 * after it are the other half — one frame to paint the start, one to hand over
 * the destination, because a zero-delay timeout is coalesced into the first
 * paint and skips the transition.
 *
 * Opacity and transform only, so the compositor carries it without laying the
 * screen out again on every frame.
 */
export function StackScene({ children }: { children: ReactNode }) {
  // Every hook runs on both platforms — a hook below an early return is React
  // error #310, which this project has shipped (`CLAUDE.md` §1, convention 4).
  const focused = useIsFocused();
  /*
    The stack's index, selected rather than the whole state: React Navigation
    only re-renders this on a change to the selected value, and `children` is
    the same element object across those renders, so the screen underneath is
    not re-rendered with it.
  */
  const index = useNavigationState((state) => state.index);
  const reduceMotion = useReducedMotion();
  const still = Platform.OS !== 'web' || reduceMotion;

  /** The stack index this scene last saw — see `sceneDirection` on why not focus. */
  const [seen, setSeen] = useState<number | null>(null);
  const [direction, setDirection] = useState<SceneDirection>('none');
  const [arrived, setArrived] = useState(true);

  if (seen !== index) {
    // Render-phase, deliberately: this has to be the state the browser paints
    // first, and an effect is a frame too late. React re-renders immediately
    // and discards the output above, so nothing is committed twice.
    const next = still ? 'none' : sceneDirection(seen, index);
    setSeen(index);
    setDirection(next);
    // `none` is the app's own first screen and a state change that was not a
    // navigation. Nothing to travel, so nothing to wait for.
    setArrived(next === 'none');
  }

  useEffect(() => {
    if (arrived || still || !focused) {
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) {
        cancelAnimationFrame(second);
      }
    };
  }, [arrived, focused, still]);

  if (still) {
    return <View style={styles.scene}>{children}</View>;
  }

  return <View style={[styles.scene, entering(direction, arrived)]}>{children}</View>;
}

/** The web build's entrance, as inline CSS the compositor can run. */
function entering(direction: SceneDirection, arrived: boolean): ViewStyle {
  return {
    opacity: arrived ? 1 : 0,
    transform: [{ translateX: arrived ? 0 : sceneOffset(direction) }],
    transitionProperty: 'opacity, transform',
    transitionDuration: `${motion.push}ms`,
    // The one easing curve, as CSS — `EASE_OUT` in `design/motion.ts`.
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: arrived ? 'auto' : 'opacity, transform',
  } as unknown as ViewStyle;
}

const styles = StyleSheet.create({
  scene: {
    flex: 1,
  },
});
