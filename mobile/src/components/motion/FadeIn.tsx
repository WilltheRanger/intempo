import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

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
 * Under reduced motion this renders its children plainly, with no animated
 * wrapper at all — not a zero-duration animation, which would still schedule
 * frames and still start at opacity zero for one of them.
 */
export function FadeIn({ children, index = 0, delay = 0, style }: FadeInProps) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      return;
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
