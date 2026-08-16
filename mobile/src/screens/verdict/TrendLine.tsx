import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { BORDER_WIDTH, colors } from '../../design';

/** Same full scale as the deviation bar: the pipeline's outer threshold. */
const FULL_SCALE_PCT = 20;

const HEIGHT = 96;
const VIEW_WIDTH = 300;

export interface TrendLineProps {
  /** Rolling mean across the take, rush-positive, percent of a beat. */
  trend: number[];
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * How the tempo drifted across the take.
 *
 * The centre rule is the target: above it is ahead of the beat, below is
 * behind. One line and one rule — a grid would imply a precision the rolling
 * mean doesn't have, and the question this answers is "which way, and when",
 * not "by exactly how much".
 *
 * Drawn in the accent on a hairline, like every other measure in the app.
 * Nothing is encoded in colour.
 */
export function TrendLine({ trend, accessibilityLabel, style }: TrendLineProps) {
  if (trend.length < 2) {
    return null;
  }

  const points = trend
    .map((value, index) => {
      const x = (index / (trend.length - 1)) * VIEW_WIDTH;
      const clamped = Math.max(-1, Math.min(1, value / FULL_SCALE_PCT));
      // SVG y grows downward, so ahead of the beat is negated to sit above.
      const y = HEIGHT / 2 - (clamped * HEIGHT) / 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.frame, style]}
    >
      <Svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${VIEW_WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
      >
        <Line
          x1={0}
          y1={HEIGHT / 2}
          x2={VIEW_WIDTH}
          y2={HEIGHT / 2}
          stroke={colors.borderStrong}
          strokeWidth={BORDER_WIDTH}
        />
        <Polyline
          points={points}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          // Set in user units against a stretched viewBox, so without this the
          // stroke thickens horizontally as the container widens.
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: HEIGHT,
  },
});
