import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { Text } from '../primitives/Text';
import { BORDER_WIDTH, colors, motion } from '../../design';
import { axisLabels, plotFraction, type SessionTrend } from '../../lib/insights/sessionTrend';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * Takes as a line, one point each (`redesign/Insights.dc.html`,
 * `redesign/PieceDetail.dc.html`).
 *
 * **Every point is a take, not a day**, because students do not practise
 * daily and a calendar axis draws the gaps as flat stretches nobody played.
 * The axis reads "Take 1" to "Take N".
 *
 * The anatomy is the redesign's: the on-tempo band either side of the beat,
 * the beat as a line through it, the takes joined by a gold line with a dot on
 * each and a larger ringed dot on the latest, and — on Insights, where the
 * chart is the screen's subject — a faint wash between the line and the beat.
 * The vertical span is fitted to the takes (`trendRange`), so a musician who
 * rushes sees the drift at full size rather than in the top half of a
 * symmetric axis.
 *
 * The line draws itself in and the dots follow; with Reduce Motion it is
 * simply there.
 */

/** The left-hand column the axis words sit in. */
const GUTTER = 50;

/** The latest take's dot, and the others'. */
const LATEST_RADIUS = 5.5;
const DOT_RADIUS = 2.9;

/** Room on the right so the latest dot is not clipped. */
const EDGE = LATEST_RADIUS + 2;

const DRAW_MS = motion.spring * 3;

/** Axis words closer than this to the beat's label are left off. */
const LABEL_CLEARANCE = 18;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

export interface SessionTrendChartProps {
  trend: SessionTrend;
  accessibilityLabel: string;
  /** The plot's height in points. Insights draws it large; a card, smaller. */
  height?: number;
  /** The wash between the line and the beat. */
  area?: boolean;
  /**
   * Smaller dots and a thinner line, for a chart inside a card
   * (`redesign/PieceDetail.dc.html`). The latest dot is ringed in the card's
   * white rather than the page's ivory.
   */
  compact?: boolean;
  /**
   * The number of the first take drawn, when the chart shows the newest few
   * of a longer history: a piece with 40 takes whose chart said "Take 1" at its
   * left edge would be naming the wrong take. Insights' chart is "your last N
   * takes" and counts from 1.
   */
  firstTake?: number;
  style?: StyleProp<ViewStyle>;
}

export function SessionTrendChart({
  trend,
  accessibilityLabel,
  height = 190,
  area = false,
  compact = false,
  firstTake = 1,
  style,
}: SessionTrendChartProps) {
  const dotRadius = compact ? 2.6 : DOT_RADIUS;
  const latestRadius = compact ? 4.5 : LATEST_RADIUS;
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const plotWidth = Math.max(0, width - GUTTER);
  const { range } = trend;
  const yOf = (value: number) => plotFraction(value, range) * height;
  const zeroY = yOf(0);

  const points = useMemo(() => {
    if (plotWidth <= 0) {
      return [];
    }
    const last = Math.max(trend.points.length - 1, 1);
    const span = Math.max(plotWidth - EDGE, 1);
    return trend.points.map((point, index) => ({
      ...point,
      x: GUTTER + (index / last) * span,
      y: plotFraction(point.value, trend.range) * height,
    }));
  }, [trend, plotWidth, height]);

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const length = points.reduce(
    (total, point, index) =>
      index === 0 ? 0 : total + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y),
    0,
  );

  const draw = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || points.length === 0) {
      draw.setValue(1);
      return;
    }
    draw.setValue(0);
    const animation = Animated.timing(draw, {
      toValue: 1,
      duration: DRAW_MS,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [draw, reduceMotion, points.length, line]);

  const dashOffset = draw.interpolate({ inputRange: [0, 1], outputRange: [length, 0] });
  const fade = draw.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });
  const dotsIn = draw.interpolate({ inputRange: [0, 0.76, 1], outputRange: [0, 0, 1] });

  const labels = axisLabels(
    trend.points.map((point) => point.value),
    range,
  );
  const latest = points[points.length - 1];

  return (
    <View style={style}>
      <View
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={{ height }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && points.length > 0 ? (
          <Svg width={width} height={height} style={styles.svg}>
            <Rect
              x={GUTTER}
              y={yOf(range.bandTop)}
              width={plotWidth}
              height={Math.max(0, yOf(range.bandBottom) - yOf(range.bandTop))}
              fill={colors.border}
              opacity={0.5}
            />
            <Line
              x1={GUTTER}
              y1={zeroY}
              x2={width - EDGE}
              y2={zeroY}
              stroke={colors.chartRule}
              strokeWidth={BORDER_WIDTH}
            />
            {area ? (
              <AnimatedPath
                d={`${line} L ${latest.x.toFixed(2)} ${zeroY.toFixed(2)} L ${points[0].x.toFixed(2)} ${zeroY.toFixed(2)} Z`}
                fill={colors.accent}
                opacity={Animated.multiply(fade, 0.1)}
              />
            ) : null}
            <AnimatedPath
              d={line}
              fill="none"
              stroke={colors.accent}
              strokeWidth={compact ? 2 : 2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${length} ${length}`}
              strokeDashoffset={dashOffset}
            />
            <AnimatedG opacity={dotsIn}>
              {points.slice(0, -1).map((point) => (
                <Circle
                  key={point.id}
                  cx={point.x}
                  cy={point.y}
                  r={dotRadius}
                  fill={colors.accent}
                  opacity={0.85}
                />
              ))}
              <Circle
                cx={latest.x}
                cy={latest.y}
                r={latestRadius}
                fill={colors.accent}
                stroke={compact ? colors.surface : colors.bg}
                strokeWidth={compact ? 2 : 2.4}
              />
            </AnimatedG>
          </Svg>
        ) : null}

        {/* The axis words, in the gutter, at the heights they name. */}
        {labels.ahead && zeroY > LABEL_CLEARANCE ? (
          <Text variant="caption" color="textTertiary" style={[styles.axis, { top: 0 }]}>
            Ahead
          </Text>
        ) : null}
        <Text variant="caption" color="textTertiary" style={[styles.axis, { top: zeroY - 7 }]}>
          On beat
        </Text>
        {labels.behind && height - zeroY > LABEL_CLEARANCE ? (
          <Text variant="caption" color="textTertiary" style={[styles.axis, { bottom: 0 }]}>
            Behind
          </Text>
        ) : null}
      </View>

      <View style={styles.xAxis}>
        <Text variant="caption" color="textTertiary">
          Take {firstTake}
        </Text>
        <Text variant="caption" color="textTertiary">
          Take {firstTake + trend.points.length - 1}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: {
    position: 'absolute',
    left: 0,
    top: 0,
    ...Platform.select({ web: { overflow: 'visible' as const }, default: {} }),
  },
  axis: {
    position: 'absolute',
    left: 0,
    // 12 is the app's smallest size (`typography.caption`).
    fontSize: 12,
    lineHeight: 16,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
    marginLeft: GUTTER,
  },
});
