import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';

import { EASE_OUT, RISE_DISTANCE, STAGGER_CAP, STAGGER_MS, motion } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

export interface FadeInProps {
  children: ReactNode;
  /**
   * Position in a list. Multiplied by `STAGGER_MS` to offset the start, capped
   * so a forty-row library doesn't spend a second and a half arriving.
   */
  index?: number;
  /** Extra delay before this element starts, on top of any stagger. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Content arriving: a fade with a small rise.
 *
 * The rise is what makes it feel like the screen assembled rather than
 * flickered — eight points, barely a shift, but it gives the motion a
 * direction and so a sense that the content came from somewhere.
 *
 * Mount-only. Nothing here re-runs on update, because content that re-animates
 * every time a query refetches is content that flickers at someone reading it.
 *
 * Native uses the native animation driver. Web hands the same opacity and
 * transform to CSS after the first painted frame, so a long Library does not
 * run one JavaScript animation loop per row while the musician is trying to
 * scroll it. The browser can composite those two properties independently.
 *
 * Under reduced motion this renders its children plainly, with no transition.
 */
export function FadeIn({ children, index = 0, delay = 0, style }: FadeInProps) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [webVisible, setWebVisible] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      setWebVisible(true);
      return;
    }

    if (Platform.OS === 'web') {
      // Two animation frames guarantee the hidden starting state has painted
      // before the compositor receives the destination state. A zero-delay
      // timeout can be coalesced into the first paint and skip the transition.
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setWebVisible(true));
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        if (secondFrame) {
          cancelAnimationFrame(secondFrame);
        }
      };
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      delay: delay + Math.min(index, STAGGER_CAP) * STAGGER_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // Mount-only on purpose; see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  if (reduceMotion) {
    return <Animated.View style={style}>{children}</Animated.View>;
  }

  if (Platform.OS === 'web') {
    const staggerDelay = delay + Math.min(index, STAGGER_CAP) * STAGGER_MS;
    return (
      <Animated.View
        style={[
          style,
          {
            opacity: webVisible ? 1 : 0,
            transform: [{ translateY: webVisible ? 0 : RISE_DISTANCE }],
            transitionProperty: 'opacity, transform',
            transitionDuration: `${motion.base}ms`,
            transitionDelay: `${staggerDelay}ms`,
            transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: webVisible ? 'auto' : 'opacity, transform',
          } as unknown as ViewStyle,
        ]}
      >
        {children}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [RISE_DISTANCE, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
