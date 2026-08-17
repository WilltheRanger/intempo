import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { SKELETON_PULSE, colors, radii, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** Defaults to the small radius. Pass `radii.pill` for a chip or bar. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * One placeholder block.
 *
 * Pulses opacity rather than sweeping a shimmer across itself. A shimmer is a
 * moving gradient and the brief bans gradients; a slow breath is also quieter,
 * which suits a screen whose only job is to say "nearly there".
 *
 * The fill is the border colour, not a grey: on this warm ivory ground a
 * neutral grey reads as cold and immediately as foreign.
 *
 * Under reduced motion it holds still at the dimmer end of the pulse — visible
 * as a placeholder, not mistaken for content.
 */
export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(SKELETON_PULSE.from)).current;

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: SKELETON_PULSE.to,
          duration: SKELETON_PULSE.duration,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: SKELETON_PULSE.from,
          duration: SKELETON_PULSE.duration,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      // Placeholders are not content. A screen reader should skip them
      // entirely rather than announce a dozen unlabelled boxes.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { width, height, borderRadius: radius ?? radii.sm },
        reduceMotion ? { opacity: SKELETON_PULSE.to } : { opacity: pulse },
        style,
      ]}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of lines. The last is short, the way a paragraph ends. */
  lines?: number;
  width?: DimensionValue;
  height?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/** A run of lines standing in for a block of text. */
export function SkeletonText({
  lines = 1,
  width = '100%',
  height = 14,
  gap = spacing.sm,
  style,
}: SkeletonTextProps) {
  return (
    <View style={style}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          height={height}
          // Real text doesn't fill its last line. Ragging it is the difference
          // between a placeholder that reads as text and one that reads as a
          // stack of bars.
          width={index === lines - 1 && lines > 1 ? '62%' : width}
          style={index > 0 ? { marginTop: gap } : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.border,
  },
});
