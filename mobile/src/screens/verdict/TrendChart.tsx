import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { Text } from '../../components/primitives';
import type { MeasureVerdict } from '../../data/types';
import { BORDER_WIDTH, colors, type ColorToken } from '../../design';
import { barAtAlong, trendY, type TrendData, type TrendPoint } from '../../lib/verdict/trend';

const HEIGHT = 132;
/** Room at the right for what up and down mean, and the target on its line. */
const GUTTER = 50;
/** The dot under a bar with a mistake in it. */
const MARK = 5;
/** How much worse each tone is, so a segment takes the worse of its two ends. */
const SEVERITY: Record<string, number> = { verdictMid: 1, verdictBad: 2 };

export interface TrendChartProps {
  data: TrendData;
  measures: readonly MeasureVerdict[];
  /** The bar under the finger; null until the musician touches the graph. */
  selected: number | null;
  onSelect: (measure: number) => void;
  /** A passage shaded behind the line: the tapped bar's, or the verdict's own. */
  span?: { from: number; to: number } | null;
  /** Bars with a mistake in them: a dot under each. */
  marked?: ReadonlySet<number>;
  /** What up and down mean — "faster" and "slower", "sharp" and "flat". */
  ends: { up: string; down: string };
  /** How a bar is named to assistive tech: "Bar", "Pitch in bar". */
  name: string;
  /** What a selected bar is read out as. */
  describe: (measure: MeasureVerdict) => string;
}

/**
 * The take as a line across an on-tempo band (`lib/verdict/trend.ts`) — the
 * owner's choice, 2026-09-29, over a bar per measure.
 *
 * The band is the tolerance around the target, in the same soft fill the
 * Insights charts use; the line is ink inside it and gold or red where it
 * leaves it, so the eye goes straight to the part that went wrong. The target
 * is named once, on its line. Nothing else is labelled but the ends.
 *
 * **The whole graph answers the finger**: a tap or a drag lands on the bar
 * under it, which shades its passage and says it in one line underneath. To
 * assistive tech it is one slider, stepped a bar at a time, as the chart
 * before it was; on the web the arrow keys step it.
 */
export function TrendChart({
  data,
  measures,
  selected,
  onSelect,
  span,
  marked,
  ends,
  name,
  describe,
}: TrendChartProps) {
  const [measured, setMeasured] = useState(0);
  const width = Math.max(0, measured - GUTTER);
  const count = measures.length;
  const at = measures.findIndex((m) => m.measure === selected);
  const x = (along: number) => along * width;
  const y = (value: number) => trendY(value, data, HEIGHT);
  const alongOf = (index: number) => (count <= 1 ? 0.5 : index / (count - 1));

  const node = useRef<View>(null);
  const live = useRef({ width, count, measures, onSelect, at });
  live.current = { width, count, measures, onSelect, at };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (event) => pick(event.nativeEvent.locationX),
        onPanResponderMove: (event) => pick(event.nativeEvent.locationX),
      }),
    [],
  );
  function pick(px: number) {
    const { width: w, count: n, measures: ms, onSelect: select } = live.current;
    if (w <= 0 || n === 0) return;
    select(ms[barAtAlong(px / w, n)].measure);
  }

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = node.current as unknown as HTMLElement | null;
    if (!element?.addEventListener) return;
    function onKey(event: KeyboardEvent) {
      const delta =
        event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
            ? -1
            : 0;
      if (delta === 0) return;
      event.preventDefault();
      step(live.current, delta);
    }
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  }, []);

  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    setMeasured((current) => (current === next ? current : next));
  }

  // The band as one shape: along its top edge, then back along its bottom.
  const bandPath = data.band.length
    ? `M ${data.band.map((b) => `${x(b.at)},${y(b.high)}`).join(' L ')} L ${[...data.band]
        .reverse()
        .map((b) => `${x(b.at)},${y(b.low)}`)
        .join(' L ')} Z`
    : '';
  const centre = data.band.length ? y(data.band[0].centre) : HEIGHT / 2;
  const selectedPoint: TrendPoint | null =
    selected === null ? null : (data.runs.flat().find((p) => p.measure === selected) ?? null);
  const spanFrom = span ? measures.findIndex((m) => m.measure === span.from) : -1;
  const spanTo = span ? measures.findIndex((m) => m.measure === span.to) : -1;
  const current = at >= 0 ? measures[at] : null;

  return (
    <View>
      <View
        ref={node}
        style={styles.plot}
        onLayout={handleLayout}
        role="slider"
        aria-label={
          current
            ? `${name} ${current.measure} of ${count}: ${describe(current)}`
            : `Across the take, ${count} bars`
        }
        aria-valuemin={1}
        aria-valuemax={count}
        // Nothing picked is no value, not a value below the minimum.
        aria-valuenow={at >= 0 ? at + 1 : undefined}
        focusable
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          step(live.current, event.nativeEvent.actionName === 'increment' ? 1 : -1)
        }
        {...pan.panHandlers}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT} pointerEvents="none">
            {spanFrom >= 0 && spanTo >= spanFrom ? (
              <Rect
                x={x(alongOf(spanFrom)) - (spanFrom === spanTo ? 6 : 0)}
                y={0}
                width={Math.max(12, x(alongOf(spanTo)) - x(alongOf(spanFrom)))}
                height={HEIGHT}
                fill={colors.accent}
                opacity={0.12}
              />
            ) : null}
            <Path d={bandPath} fill={colors.border} opacity={0.6} />
            <Line x1={0} x2={width} y1={centre} y2={centre} stroke={colors.chartRule} strokeWidth={BORDER_WIDTH} />
            {data.runs.flatMap((run) =>
              run.slice(1).map((point, i) => {
                const from = run[i];
                const worse =
                  (SEVERITY[point.tone ?? ''] ?? 0) >= (SEVERITY[from.tone ?? ''] ?? 0)
                    ? point.tone
                    : from.tone;
                return (
                  <Line
                    key={`${from.measure}-${point.measure}`}
                    x1={x(from.at)}
                    y1={y(from.value)}
                    x2={x(point.at)}
                    y2={y(point.value)}
                    stroke={worse ? colors[worse as ColorToken] : colors.textSecondary}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                );
              }),
            )}
            {data.runs
              .filter((run) => run.length === 1)
              .map((run) => (
                <Circle key={run[0].measure} cx={x(run[0].at)} cy={y(run[0].value)} r={2.5} fill={colors.textSecondary} />
              ))}
            {selectedPoint ? (
              <>
                <Line
                  x1={x(selectedPoint.at)}
                  x2={x(selectedPoint.at)}
                  y1={0}
                  y2={HEIGHT}
                  stroke={colors.chartRule}
                  strokeWidth={BORDER_WIDTH}
                />
                <Circle
                  cx={x(selectedPoint.at)}
                  cy={y(selectedPoint.value)}
                  r={5}
                  fill={selectedPoint.tone ? colors[selectedPoint.tone] : colors.textPrimary}
                  stroke={colors.bg}
                  strokeWidth={2}
                />
              </>
            ) : null}
          </Svg>
        ) : null}
        <Text variant="caption" color="textTertiary" style={[styles.end, styles.endUp]} pointerEvents="none">
          {ends.up}
        </Text>
        {data.centreLabel ? (
          <Text
            variant="caption"
            color="textSecondary"
            style={[styles.end, { top: Math.max(14, Math.min(HEIGHT - 30, centre - 8)) }]}
            pointerEvents="none"
          >
            {data.centreLabel}
          </Text>
        ) : null}
        <Text variant="caption" color="textTertiary" style={[styles.end, styles.endDown]} pointerEvents="none">
          {ends.down}
        </Text>
      </View>

      {marked && marked.size > 0 && width > 0 ? (
        <View style={styles.marks} pointerEvents="none">
          {measures.map((m, index) =>
            marked.has(m.measure) ? (
              <View key={m.measure} style={[styles.mark, { left: x(alongOf(index)) - MARK / 2 }]} />
            ) : null,
          )}
        </View>
      ) : null}
      <View style={styles.axis}>
        <Text variant="caption" color="textTertiary" style={styles.number}>
          Bar {measures[0]?.measure ?? ''}
        </Text>
        <Text variant="caption" color="textTertiary" style={styles.number}>
          {measures[measures.length - 1]?.measure ?? ''}
        </Text>
      </View>
    </View>
  );
}

/** Select the bar `delta` along from the selected one, clamped at the ends. */
function step(
  {
    measures,
    at,
    onSelect,
  }: { measures: readonly MeasureVerdict[]; at: number; onSelect: (measure: number) => void },
  delta: number,
) {
  // The first step onto a graph with nothing picked lands on its first bar.
  const next = measures[at < 0 ? 0 : Math.max(0, Math.min(measures.length - 1, at + delta))];
  if (next) onSelect(next.measure);
}

const styles = StyleSheet.create({
  plot: {
    height: HEIGHT,
  },
  end: {
    position: 'absolute',
    right: 0,
    width: GUTTER - 8,
    textAlign: 'right',
  },
  endUp: {
    top: -2,
  },
  endDown: {
    bottom: -2,
  },
  marks: {
    height: MARK,
    marginTop: 6,
    marginRight: GUTTER,
  },
  mark: {
    position: 'absolute',
    top: 0,
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    backgroundColor: colors.textSecondary,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginRight: GUTTER,
  },
  number: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
});
