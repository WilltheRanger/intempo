import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Line,
  Path,
  Pattern,
  Rect,
  Stop,
} from 'react-native-svg';

import { Text } from '../primitives/Text';
import { BORDER_WIDTH, colors, motion, spacing } from '../../design';
import { plotFraction, type SessionTrend } from '../../lib/insights/sessionTrend';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * Recent sessions as a line, with the beat as its centre.
 *
 * **Replaces the single deviation bar on Insights.** That bar drew one number
 * — the thirty-day mean — and a mean has no shape: it cannot show four
 * sessions steadily improving, or one outlier dragging the average, which are
 * the two things somebody opening this screen wants to know. Same window, same
 * measurement, drawn as what it is.
 *
 * The composition came from a reference the owner supplied. What was taken is
 * the *anatomy* — a dotted field, dashed rules, a soft area under the curve,
 * dots on only the points worth naming, and the line drawing itself in. What
 * was not taken is its palette, its drop shadows or its numbers: every colour
 * here is a token, and the one figure on the chart is the axis it is measured
 * against.
 *
 * ## Why this does not break design law 6
 *
 * Gradients and floating rounded things are exceptions rather than the default
 * styling language, and a chart is where the exception is the point:
 *
 *  - The **area gradient is the reading**, not a decoration. It gives the line
 *    a direction — you can see at a glance which side of the beat the session
 *    sat on without tracing the curve against the rule.
 *  - The **dotted field and the dashed rules are the scale.** Remove them and
 *    a point halfway up the box means nothing; remove an ornament and nothing
 *    happens. That is the test law 10 asks for.
 *  - **No card.** It sits on the page, per law 3.
 *
 * ## The axis is the thresholds, not the data
 *
 * The top and bottom of the box are the outer thresholds the pipeline judged
 * these takes by, so a point touching an edge means *severe* rather than "the
 * tallest thing in this window". `sessionTrend.ts` owns that, along with which
 * sessions are plotted at all and which earn a dot.
 */

/** Plot height. Tall enough for a curve to have shape, short enough to scan. */
const HEIGHT = 168;

/** Room for the y labels, sized to hold "Ahead" without wrapping. */
const GUTTER = 52;

/** How far a dot sits from the line's own weight. */
const DOT_RADIUS = 4.5;

/**
 * Horizontal inset, so the first and last dots are drawn whole.
 *
 * **Found in a screenshot, not in arithmetic.** With the series spanning the
 * full width, the oldest session sits at x=0 and the latest at x=width — and
 * both dots came out as half circles against the edges of the plot. The dot is
 * the mark that says "this session is worth looking at", and half of one reads
 * as a rendering fault. Its radius plus its ring.
 */
const EDGE_INSET = DOT_RADIUS + 2;

/** The dotted field behind the plot: one dot every this many points. */
const FIELD_PITCH = 18;

/** How long the line takes to draw itself in. */
const DRAW_MS = motion.spring * 3;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

/**
 * A monotone cubic through the points.
 *
 * **Not `Polyline`, which is what the verdict screen's trend uses**, and not a
 * plain Catmull-Rom either. A session series has few points and wide gaps, so
 * straight segments read as a zigzag and an unconstrained spline overshoots —
 * it invents a session better or worse than any that happened, between two
 * that did. The monotone constraint is exactly the rule that a curve may not
 * leave the range of the points it joins.
 */
function monotonePath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 2) {
    return '';
  }

  const slopes: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  // Tangent at each point: the average of its neighbours' slopes, flattened to
  // zero wherever they disagree in sign — that is the turning point, and a
  // tangent through it is what makes a spline overshoot.
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[slopes.length - 1];
    return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  });

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = (points[i + 1].x - points[i].x) / 3;
    d +=
      ` C ${(points[i].x + dx).toFixed(2)} ${(points[i].y + tangents[i] * dx).toFixed(2)}` +
      ` ${(points[i + 1].x - dx).toFixed(2)} ${(points[i + 1].y - tangents[i + 1] * dx).toFixed(2)}` +
      ` ${points[i + 1].x.toFixed(2)} ${points[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/** Close the curve down to the baseline so it can be filled. */
function areaPath(d: string, points: readonly { x: number; y: number }[], baseline: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  return `${d} L ${last.x.toFixed(2)} ${baseline} L ${first.x.toFixed(2)} ${baseline} Z`;
}

/**
 * Roughly how long the path is, for the draw-on dash.
 *
 * The straight-line distance through the points, which understates a curve
 * slightly — harmless here, because the dash only has to be *at least* the
 * path length for the reveal to start fully hidden.
 */
function approximateLength(points: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

export interface SessionTrendChartProps {
  trend: SessionTrend;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

export function SessionTrendChart({ trend, accessibilityLabel, style }: SessionTrendChartProps) {
  const reduceMotion = useReducedMotion();
  // **Measured rather than a stretched viewBox.** `TrendLine` draws into a
  // fixed viewBox with `preserveAspectRatio="none"`, which is fine for one
  // stroke with `vectorEffect` on it and wrong the moment there are dots: a
  // circle in a horizontally stretched box comes out an ellipse.
  const [width, setWidth] = useState(0);

  const points = useMemo(() => {
    if (width <= 0) {
      return [];
    }
    const last = Math.max(trend.points.length - 1, 1);
    const span = Math.max(width - EDGE_INSET * 2, 1);
    return trend.points.map((point, index) => ({
      ...point,
      x: EDGE_INSET + (index / last) * span,
      y: plotFraction(point.value, trend.fullScale) * HEIGHT,
    }));
  }, [trend, width]);

  const line = useMemo(() => monotonePath(points), [points]);
  const length = useMemo(() => approximateLength(points), [points]);

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
      // An SVG geometry property, so this cannot run on the native driver —
      // it is one interpolated number per frame on a path that is already
      // being rasterised, not a layout pass.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [draw, reduceMotion, points.length, line]);

  const dashOffset = draw.interpolate({ inputRange: [0, 1], outputRange: [length, 0] });
  // **The other two layers follow the line rather than waiting for it.** Drawn
  // flat, the area and the dots were fully there while the line was still a
  // stub — which reads as a chart with its line missing, not as one arriving.
  // The area rises with the stroke; the dots land behind it, so a dot never
  // marks a point the line has not reached.
  const areaOpacity = draw.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const dotOpacity = draw.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View style={style}>
      <View
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={styles.plotRow}
      >
        {/* Read top to bottom: ahead of the beat, on it, behind it. */}
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

        <View style={styles.plot} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && points.length > 0 ? (
            <Svg width={width} height={HEIGHT}>
              <Defs>
                <LinearGradient id="session-area" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={0.18} />
                  <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
                </LinearGradient>
                {/* The field. Dots rather than a grid of lines: it reads as
                    texture at a glance and as a scale when you look for one,
                    which is the order of attention law 4 asks for. */}
                <Pattern
                  id="session-field"
                  x="0"
                  y="0"
                  width={FIELD_PITCH}
                  height={FIELD_PITCH}
                  patternUnits="userSpaceOnUse"
                >
                  <Circle
                    cx={FIELD_PITCH / 2}
                    cy={FIELD_PITCH / 2}
                    r={1}
                    fill={colors.borderStrong}
                    fillOpacity={0.55}
                  />
                </Pattern>
              </Defs>

              <Rect x={0} y={0} width={width} height={HEIGHT} fill="url(#session-field)" />

              {/* The thresholds, dashed, at a quarter and three quarters --
                  half of severe in each direction. */}
              {[0.25, 0.75].map((fraction) => (
                <Line
                  key={fraction}
                  x1={0}
                  y1={HEIGHT * fraction}
                  x2={width}
                  y2={HEIGHT * fraction}
                  stroke={colors.border}
                  strokeWidth={BORDER_WIDTH}
                  strokeDasharray="4 8"
                />
              ))}

              {/* The beat. Solid, because it is the one line that is a fact
                  rather than a division of the axis. */}
              <Line
                x1={0}
                y1={HEIGHT / 2}
                x2={width}
                y2={HEIGHT / 2}
                stroke={colors.borderStrong}
                strokeWidth={BORDER_WIDTH}
              />

              <AnimatedPath
                d={areaPath(line, points, HEIGHT / 2)}
                fill="url(#session-area)"
                opacity={areaOpacity}
              />

              <AnimatedPath
                d={line}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${length} ${length}`}
                strokeDashoffset={dashOffset}
              />

              <AnimatedG opacity={dotOpacity}>
                {points
                  .filter((point) => point.notable)
                  .map((point) => (
                    <Circle
                      key={point.id}
                      cx={point.x}
                      cy={point.y}
                      r={DOT_RADIUS}
                      fill={colors.accent}
                      // The page colour, not white: a white ring on an ivory
                      // page is a visible halo, and in dark mode it is a hole.
                      stroke={colors.bg}
                      strokeWidth={2}
                    />
                  ))}
              </AnimatedG>
            </Svg>
          ) : null}
        </View>
      </View>

      <View style={styles.xAxis}>
        <Text variant="metadataSmall" color="textTertiary">
          {trend.points.length} sessions
        </Text>
        <Text variant="metadataSmall" color="textTertiary">
          Latest
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
    ...Platform.select({ web: { overflow: 'hidden' }, default: {} }),
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginLeft: GUTTER,
  },
});
