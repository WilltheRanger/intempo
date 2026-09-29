import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path } from 'react-native-svg';

import { Text } from '../../components/primitives';
import type { MeasureVerdict } from '../../data/types';
import { BORDER_WIDTH, colors } from '../../design';
import {
  barAtAlong,
  outsidePath,
  smoothPath,
  trendY,
  type TrendData,
  type TrendPoint,
} from '../../lib/verdict/trend';

/**
 * Tall enough to read the shape from a music stand (the owner, 2026-09-29,
 * "taller graph"), and the one thing on the screen below the title.
 */
const HEIGHT = 220;
/** The line: heavy enough to be the subject, not a grid line. */
const STROKE = 3;
/** The rail under the graph, and the dots under the rail. */
const RAIL_HEIGHT = 22;
const RAIL_Y = 5;
const MARK_Y = 16;
const MARK = 2.5;

export interface TrendChartProps {
  data: TrendData;
  measures: readonly MeasureVerdict[];
  /** The bar under the finger; null until the musician touches the graph. */
  selected: number | null;
  onSelect: (measure: number) => void;
  /** A passage marked on the rail: the tapped bar's, or the verdict's own. */
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
 * owner's choice, 2026-09-29, over a bar per measure, and then over two other
 * ways of drawing it ("A · Refined line").
 *
 * **One curve, and colour only where it means something.** The line is ink
 * inside the band and turns gold exactly where it crosses the band's edge —
 * clipped, not decided per bar, so it cannot change colour a bar late — and
 * red past the far edge. The stretch outside is tinted the same colour, faint,
 * so how far out it went reads as an area rather than a number. The curve is
 * monotone (`smoothPath`): it never peaks higher than the bar that made it.
 *
 * **No boxes.** The band is the only filled shape; it runs the full width with
 * no ends. The passage is marked on the rail underneath, not by a block laid
 * over the graph, and a stretch the pipeline could not time is dotted on the
 * rail rather than left as a line that stops in mid-air. The labels sit inside
 * the graph at its right edge, so it takes the whole column.
 *
 * **The whole graph answers the finger**: a tap or a drag lands on the bar
 * under it, which marks its passage and says it in one line underneath. To
 * assistive tech it is one slider, stepped a bar at a time; on the web the
 * arrow keys step it.
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
  const [width, setWidth] = useState(0);
  const count = measures.length;
  const at = measures.findIndex((m) => m.measure === selected);
  const x = (along: number) => along * width;
  const y = (value: number) => trendY(value, data, HEIGHT);
  const alongOf = (index: number) => (count <= 1 ? 0.5 : index / (count - 1));
  // SVG ids are document-wide on the web, and two of these can be mounted.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

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
    setWidth((current) => (current === next ? current : next));
  }

  // The band as one shape: along its top edge, then back along its bottom.
  const bandPath = data.band.length
    ? `M ${data.band.map((b) => `${x(b.at)},${y(b.high)}`).join(' L ')} L ${[...data.band]
        .reverse()
        .map((b) => `${x(b.at)},${y(b.low)}`)
        .join(' L ')} Z`
    : '';
  const centrePath = data.band.length
    ? `M ${data.band.map((b) => `${x(b.at)},${y(b.centre)}`).join(' L ')}`
    : '';
  const centreAt = (along: number) => {
    const nearest = data.band.reduce(
      (best, b) => (Math.abs(b.at - along) < Math.abs(best.at - along) ? b : best),
      data.band[0],
    );
    return y(nearest.centre);
  };
  const curves = data.runs.map((run) => ({
    run,
    line: smoothPath(run.map((p) => ({ x: x(p.at), y: y(p.value) }))),
  }));
  // The area between the line and the target, drawn only where it is clipped
  // to outside the band: the tint under a rush.
  const areas = curves
    .filter(({ run }) => run.length > 1)
    .map(({ run, line }) => {
      const first = run[0];
      const last = run[run.length - 1];
      return `${line} L ${x(last.at)},${centreAt(last.at)} L ${x(first.at)},${centreAt(first.at)} Z`;
    });
  const near = `near${id}`;
  const far = `far${id}`;

  const selectedPoint: TrendPoint | null =
    selected === null ? null : (data.runs.flat().find((p) => p.measure === selected) ?? null);
  const spanFrom = span ? measures.findIndex((m) => m.measure === span.from) : -1;
  const spanTo = span ? measures.findIndex((m) => m.measure === span.to) : -1;
  const current = at >= 0 ? measures[at] : null;
  const centreY = data.band.length ? y(data.band[data.band.length - 1].centre) : HEIGHT / 2;

  // A stretch at the end the pipeline could not time, named once on the axis.
  const lastRun = data.runs[data.runs.length - 1];
  const lastTimed = lastRun ? lastRun[lastRun.length - 1].at : 0;
  const untimedTail = count - 1 - Math.round(lastTimed * (count - 1));

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
            <Defs>
              <ClipPath id={near}>
                <Path d={outsidePath(data.band, 'near', x, y, HEIGHT)} />
              </ClipPath>
              <ClipPath id={far}>
                <Path d={outsidePath(data.band, 'far', x, y, HEIGHT)} />
              </ClipPath>
            </Defs>
            <Path d={bandPath} fill={colors.border} opacity={0.55} />
            <Path
              d={centrePath}
              stroke={colors.chartRule}
              strokeWidth={BORDER_WIDTH}
              opacity={0.7}
              fill="none"
            />

            <G clipPath={`url(#${near})`}>
              {areas.map((d) => (
                <Path key={d} d={d} fill={colors.verdictMid} opacity={0.13} />
              ))}
            </G>
            <G clipPath={`url(#${far})`}>
              {areas.map((d) => (
                <Path key={d} d={d} fill={colors.verdictBad} opacity={0.1} />
              ))}
            </G>

            {curves.map(({ run, line }) => (
              <Path
                key={run[0].measure}
                d={line}
                stroke={colors.textSecondary}
                strokeWidth={STROKE}
                strokeLinecap="round"
                fill="none"
              />
            ))}
            <G clipPath={`url(#${near})`}>
              {curves.map(({ run, line }) => (
                <Path
                  key={run[0].measure}
                  d={line}
                  stroke={colors.verdictMid}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  fill="none"
                />
              ))}
            </G>
            <G clipPath={`url(#${far})`}>
              {curves.map(({ run, line }) => (
                <Path
                  key={run[0].measure}
                  d={line}
                  stroke={colors.verdictBad}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  fill="none"
                />
              ))}
            </G>
            {/* Where a run ends, a dot — so a line that stops reads as ending. */}
            {data.runs.map((run) => {
              const end = run[run.length - 1];
              return (
                <Circle
                  key={end.measure}
                  cx={x(end.at)}
                  cy={y(end.value)}
                  r={STROKE + 0.5}
                  fill={end.tone ? colors[end.tone] : colors.textSecondary}
                />
              );
            })}

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
                  r={6}
                  fill={selectedPoint.tone ? colors[selectedPoint.tone] : colors.textPrimary}
                  stroke={colors.bg}
                  strokeWidth={2}
                />
              </>
            ) : null}
          </Svg>
        ) : null}
        <Text
          variant="caption"
          color="textTertiary"
          style={[styles.end, styles.endUp]}
          pointerEvents="none"
        >
          {ends.up}
        </Text>
        {data.centreLabel ? (
          <Text
            variant="caption"
            color="textSecondary"
            style={[styles.end, { top: Math.max(18, Math.min(HEIGHT - 40, centreY - 20)) }]}
            pointerEvents="none"
          >
            {data.centreLabel}
          </Text>
        ) : null}
        <Text
          variant="caption"
          color="textTertiary"
          style={[styles.end, styles.endDown]}
          pointerEvents="none"
        >
          {ends.down}
        </Text>
      </View>

      {/*
        The rail: the bars the line covers in a solid hairline, the ones it
        could not time dotted, the passage in the accent, and a dot under each
        bar with a mistake in it.
      */}
      {width > 0 ? (
        <Svg width={width} height={RAIL_HEIGHT} style={styles.rail} pointerEvents="none">
          <Line
            x1={MARK}
            x2={width - MARK}
            y1={RAIL_Y}
            y2={RAIL_Y}
            stroke={colors.chartRule}
            strokeWidth={2}
            strokeDasharray="1 5"
            strokeLinecap="round"
            opacity={0.6}
          />
          {data.runs.map((run) => (
            <Line
              key={run[0].measure}
              x1={x(run[0].at)}
              x2={x(run[run.length - 1].at)}
              y1={RAIL_Y}
              y2={RAIL_Y}
              stroke={colors.border}
              strokeWidth={4}
              strokeLinecap="round"
            />
          ))}
          {spanFrom >= 0 && spanTo >= spanFrom ? (
            <Line
              x1={x(alongOf(spanFrom))}
              x2={x(alongOf(spanTo))}
              y1={RAIL_Y}
              y2={RAIL_Y}
              stroke={colors.accent}
              strokeWidth={4}
              strokeLinecap="round"
            />
          ) : null}
          {marked
            ? measures.map((m, index) =>
                marked.has(m.measure) ? (
                  <Circle
                    key={m.measure}
                    cx={x(alongOf(index))}
                    cy={MARK_Y}
                    r={MARK}
                    fill={colors.textSecondary}
                  />
                ) : null,
              )
            : null}
        </Svg>
      ) : null}
      <View style={styles.axis}>
        <Text variant="caption" color="textTertiary" style={styles.number}>
          Bar {measures[0]?.measure ?? ''}
        </Text>
        {untimedTail >= 2 ? (
          <Text variant="caption" color="textTertiary" style={[styles.number, styles.untimed]}>
            not timed
          </Text>
        ) : null}
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
    textAlign: 'right',
  },
  endUp: {
    top: -2,
  },
  endDown: {
    bottom: -2,
  },
  rail: {
    marginTop: 10,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  number: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  untimed: {
    marginLeft: 'auto',
    marginRight: 8,
  },
});
