import { useEffect, useRef, useState } from 'react';
import { Animated, Platform } from 'react-native';

import { EASE_OUT, motion } from '../../design';

export interface OverlayPresence {
  /**
   * Whether to render at all.
   *
   * Stays true through the exit animation, which is the whole point: returning
   * null the moment `visible` goes false unmounts the overlay before it has
   * finished leaving, so it vanishes instead of closing.
   */
  mounted: boolean;
  /** 0 while gone, 1 while present. The caller decides what that looks like. */
  progress: Animated.Value;
}

/**
 * The mount-and-leave lifecycle an overlay needs, in one place.
 *
 * `BottomSheet` and `ConfirmDialog` each carried their own copy — the second
 * written by copying the first on 2026-09-06, which is how the duplication got
 * here. Neither copy is complicated; the part worth having once is the ordering:
 * an overlay must outlive the `visible` prop that closed it, or its exit
 * animation plays on an element React has already removed. That is a bug that
 * looks like "the dialog doesn't animate out" and is easy to reintroduce.
 *
 * **The enter animation is the caller's**, because the two genuinely differ and
 * forcing them together would be the wrong kind of sharing: the sheet slides in
 * on a timed curve, the dialog springs. The exit is shared and deliberately
 * fixed — everything in this app leaves the same way.
 *
 * Reduced motion collapses both ends to instant rather than skipping the
 * lifecycle, so `mounted` still sequences correctly.
 */
export function useOverlayPresence(
  visible: boolean,
  reduceMotion: boolean,
  enter: (progress: Animated.Value) => Animated.CompositeAnimation,
): OverlayPresence {
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  // Read inside the effect without making the effect depend on a function the
  // caller rebuilds every render — which would restart the animation on each.
  const enterRef = useRef(enter);
  enterRef.current = enter;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reduceMotion) {
        progress.setValue(1);
        return;
      }
      const animation = enterRef.current(progress);
      animation.start();
      return () => animation.stop();
    }

    const leaving = Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? 0 : motion.fast,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    leaving.start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    return () => leaving.stop();
  }, [progress, reduceMotion, visible]);

  return { mounted, progress };
}
