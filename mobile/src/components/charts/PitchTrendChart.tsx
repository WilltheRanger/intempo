import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';

import { Text } from '../primitives/Text';
import { BORDER_WIDTH, colors } from '../../design';
import { pitchY, type PitchTrend } from '../../lib/insights/pitchTrend';

const HEIGHT = 96;
/** The left-hand column the axis words sit in. */
const GUTTER = 50;
const DOT_RADIUS = 2.9;
const LATEST_RADIUS = 5;
/** Room on the right so the latest dot is not clipped. */
const EDGE = LATEST_RADIUS + 2;

export interface PitchTrendChartProps {
  trend: PitchTrend;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * "In tune" across takes (`lib/insights/pitchTrend.ts`): the typical note's
 * distance from the player's own tuning, one point per take, with the in-tune
 * band drawn along the bottom — so a line settling into it reads as getting
 * more in tune, which is what lower means here.
 *
 * The same anatomy as the tempo line above it on Insights — gold line, a dot
 * per take, a larger ringed dot on the latest — so the two read as one
 * family, and without the draw-in: one animated chart per screen is enough.
 */
export function PitchTrendChart({ trend, accessibilityLabel, style }: PitchTrendChartProps) {
  const [width, setWidth] = useState(0);
  const plotWidth = Math.max(0, width - GUTTER - EDGE);
  const x = (index: number) =>
    GUTTER + (trend.points.length > 1 ? (index / (trend.points.length - 1)) * plotWidth : 0);
  const y = (cents: number) => pitchY(cents, trend) * (HEIGHT - 2 * EDGE) + EDGE;
  const bandTop = y(trend.inTuneCents);
  const latest = trend.points.length - 1;

  function handleLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  }

  return (
    <View style={style}>
      <View
        style={styles.plot}
        onLayout={handleLayout}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            <Rect
              x={GUTTER}
              y={bandTop}
              width={plotWidth + EDGE}
              height={Math.max(0, HEIGHT - EDGE - bandTop)}
              fill={colors.border}
              opacity={0.6}
            />
            <Rect
              x={GUTTER}
              y={HEIGHT - EDGE}
              width={plotWidth + EDGE}
              height={BORDER_WIDTH}
              fill={colors.chartRule}
            />
            <Polyline
              points={trend.points.map((p, i) => `${x(i)},${y(p.spreadCents)}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {trend.points.map((p, i) =>
              i === latest ? (
                <Circle
                  key={p.recordedAt}
                  cx={x(i)}
                  cy={y(p.spreadCents)}
                  r={LATEST_RADIUS}
                  fill={colors.accent}
                  stroke={colors.bg}
                  strokeWidth={2}
                />
              ) : (
                <Circle
                  key={p.recordedAt}
                  cx={x(i)}
                  cy={y(p.spreadCents)}
                  r={DOT_RADIUS}
                  fill={colors.accent}
                />
              ),
            )}
          </Svg>
        ) : null}
        <Text
          variant="caption"
          color="textTertiary"
          style={[styles.axis, { top: EDGE - 8 }]}
          pointerEvents="none"
        >
          {`${trend.top}¢ off`}
        </Text>
        <Text
          variant="caption"
          color="textTertiary"
          style={[styles.axis, { top: Math.min(HEIGHT - 16, bandTop + 2) }]}
          pointerEvents="none"
        >
          In tune
        </Text>
      </View>
      <View style={styles.takes}>
        <Text variant="caption" color="textTertiary">
          Take 1
        </Text>
        <Text variant="caption" color="textTertiary">
          Take {trend.points.length}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    height: HEIGHT,
  },
  axis: {
    position: 'absolute',
    left: 0,
    width: GUTTER - 6,
  },
  takes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginLeft: GUTTER,
    marginRight: EDGE,
  },
});
