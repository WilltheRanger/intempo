import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';

import { SPRING, SPRING_CSS, motion } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

/** Where the pop starts: small enough to read as arriving, not as a flicker. */
const FROM_SCALE = 0.4;

export interface PopInProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A mark arriving with a little give — the check after "What did you hear?".
 *
 * `FadeIn` is for content settling into place; this is for a confirmation,
 * which should feel like it landed. The shared spring's slight overshoot is
 * the whole of the difference, so it uses that and nothing bespoke.
 *
 * Mount-only, like `FadeIn`: the same answer re-rendered must not pop again.
 * Web hands scale and opacity to CSS after the first painted frame, on the
 * spring's CSS curve. Under reduced motion it renders its children plainly.
 */
export function PopIn({ children, style }: PopInProps) {
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
      // Two frames, so the hidden state has painted before the transition is
      // asked for; see `FadeIn`.
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

    const animation = Animated.spring(progress, {
      toValue: 1,
      ...SPRING,
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
    return (
      <Animated.View
        style={[
          style,
          {
            opacity: webVisible ? 1 : 0,
            transform: [{ scale: webVisible ? 1 : FROM_SCALE }],
            transitionProperty: 'opacity, transform',
            transitionDuration: `${motion.spring}ms`,
            transitionTimingFunction: SPRING_CSS,
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
          opacity: progress.interpolate({
            inputRange: [0, 0.6, 1],
            outputRange: [0, 1, 1],
            extrapolate: 'clamp',
          }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [FROM_SCALE, 1],
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
