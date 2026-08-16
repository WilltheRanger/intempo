import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, spacing } from '../../design';

/** Same full scale as the deviation bar: the pipeline's outer threshold. */
const FULL_SCALE_PCT = 20;

const HEIGHT = 96;
const VIEW_WIDTH = 300;

/** Room for the y labels, sized to hold "Target" without wrapping. */
const GUTTER = 54;

export interface TrendLineProps {
  /** Rolling mean across the take, rush-positive, percent of a beat. */
  trend: number[];
  /** Measure numbers at each end, so the x axis reads as the take. */
  firstMeasure: number;
  lastMeasure: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * How the tempo drifted across the take.
 *
 * Both axes are labelled, so the chart carries its own explanation rather than
 * needing a sentence under it: the centre rule is named Target, the sides of
 * it are named, and the ends carry measure numbers that tie back to the list
 * below.
 *
 * One line and one rule. A grid would imply a precision the rolling mean
 * doesn't have — the question this answers is which way and when, not by
 * exactly how much.
 */
export function TrendLine({
  trend,
  firstMeasure,
  lastMeasure,
  accessibilityLabel,
  style,
}: TrendLineProps) {
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
    <View style={style}>
      <View
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={styles.plotRow}
      >
        {/* The y axis, read top to bottom: ahead, on the beat, behind. */}
        <View style={styles.gutter}>
          <Text variant="metadataSmall" color="textTertiary">
            Ahead
          </Text>
          <Text variant="metadataSmall" color="textSecondary">
            Target
          </Text>
          <Text variant="metadataSmall" color="textTertiary">
            Behind
          </Text>
        </View>

        <View style={styles.plot}>
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
              // Set in user units against a stretched viewBox, so without this
              // the stroke thickens horizontally as the container widens.
              vectorEffect="non-scaling-stroke"
            />
          </Svg>
        </View>
      </View>

      {/* The x axis. Numbers rather than "start" and "end", so a measure on
          the line can be found in the list below. */}
      <View style={styles.xAxis}>
        <Text variant="metadataSmall" color="textTertiary">
          Measure {firstMeasure}
        </Text>
        <Text variant="metadataSmall" color="textTertiary">
          {lastMeasure}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plotRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  gutter: {
    width: GUTTER,
    height: HEIGHT,
    justifyContent: 'space-between',
  },
  plot: {
    flex: 1,
    height: HEIGHT,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    // Aligned under the plot, not the labels beside it.
    marginLeft: GUTTER,
  },
});
