import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, motion, radii } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

export interface ProgressBarProps {
  /** 0–1. Null renders nothing rather than an empty track. */
  value: number | null;
  height?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A thin progress track. One of the few places the accent colour appears.
 *
 * Renders nothing when `value` is null — an empty track reads as "no progress
 * yet", which is a different claim from "we don't know".
 */
export function ProgressBar({
  value,
  height = 4,
  accessibilityLabel,
  style,
}: ProgressBarProps) {
  const reduceMotion = useReducedMotion();
  const fill = useRef(new Animated.Value(0)).current;
  const target = value === null ? 0 : Math.min(Math.max(value, 0), 1);

  useEffect(() => {
    if (reduceMotion) {
      fill.setValue(target);
      return;
    }
    const animation = Animated.timing(fill, {
      toValue: target,
      duration: motion.base,
      // Width isn't supported by the native driver.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [fill, reduceMotion, target]);

  if (value === null) {
    return null;
  }

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
      style={[styles.track, { height }, style]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            height,
            width: fill.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
  },
});
