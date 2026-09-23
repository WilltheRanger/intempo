import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';

import { arrival, useArrival } from '../../data/arrival';
import { useReducedMotion } from '../../lib/useReducedMotion';

/** The prototype's `rise-in`: 620ms, ease-out, opacity only. */
const RISE_MS = 620;

/**
 * Today fading in, the once, straight after "Start practicing"
 * (`redesign/TodayLight.dc.html`, `.rise-in`).
 *
 * Every other arrival at Today is immediate — a tab switch, a launch, a back
 * from a pushed screen — because a screen that fades in every time it is
 * reached is a screen that is slow every time. This is the one moment there is
 * something to mark: the app, for the first time. Reduce Motion skips it.
 *
 * Decided once, on mount, so that settling `arrival` at the end does not
 * re-render the screen back to invisible.
 */
export function RiseIn({ children }: { children: ReactNode }) {
  const arrived = useArrival();
  const reduceMotion = useReducedMotion();
  const [rising] = useState(() => arrived === 'riseIn' && !reduceMotion);
  const opacity = useRef(new Animated.Value(rising ? 0 : 1)).current;

  useEffect(() => {
    if (!rising) {
      if (arrived === 'riseIn') {
        arrival.settled();
      }
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: RISE_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start(() => arrival.settled());
    return () => {
      animation.stop();
      // Never leave Today half-faded because the effect was torn down early.
      opacity.setValue(1);
    };
    // Once, on mount: `arrived` changing to `none` is this effect's own doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Animated.View style={[styles.fill, { opacity }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
