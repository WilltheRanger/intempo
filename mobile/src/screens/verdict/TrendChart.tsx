import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { TrendPlot } from '../../components/charts/TrendPlot';
import { Text } from '../../components/primitives';
import type { MeasureVerdict } from '../../data/types';
import { moveIndex, sliderMove, type SliderMove } from '../../lib/sliderKeys';
import { barAtAlong, type TrendData, type TrendPoint } from '../../lib/verdict/trend';

/**
 * Tall enough to read the shape from a music stand (the owner, 2026-09-29,
 * "taller graph"), and the one thing on the screen below the title.
 */
const HEIGHT = 220;

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
 * The take as a line across an on-tempo band, bar by bar — the owner's choice,
 * 2026-09-29, over a bar per measure, and then over two other ways of drawing
 * it ("A · Refined line"). The drawing is `TrendPlot`, shared with every other
 * trend in the app; this adds the finger and the bar axis.
 *
 * **The whole graph answers the finger**: a tap or a drag lands on the bar
 * under it, which marks its passage on the rail and says it in one line
 * underneath. To assistive tech it is one slider, stepped a bar at a time; on
 * the web the arrow keys step it. A stretch the pipeline could not time at the
 * end is named once on the axis.
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
      const move = sliderMove(event.key, { big: PHRASE });
      if (!move) return;
      event.preventDefault();
      go(live.current, move);
    }
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  }, []);

  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  }

  const selectedPoint: TrendPoint | null =
    selected === null ? null : (data.runs.flat().find((p) => p.measure === selected) ?? null);
  const spanFrom = span ? measures.findIndex((m) => m.measure === span.from) : -1;
  const spanTo = span ? measures.findIndex((m) => m.measure === span.to) : -1;
  const current = at >= 0 ? measures[at] : null;
  const marks = marked
    ? measures.flatMap((m, index) => (marked.has(m.measure) ? [alongOf(index)] : []))
    : [];

  // A stretch at the end the pipeline could not time, named once on the axis.
  const lastRun = data.runs[data.runs.length - 1];
  const lastTimed = lastRun ? lastRun[lastRun.length - 1].at : 0;
  const untimedTail = count - 1 - Math.round(lastTimed * (count - 1));

  return (
    <View>
      <View
        ref={node}
        onLayout={handleLayout}
        role="slider"
        // **The name stays; the value says where you are.** A screen reader
        // announces a slider's value as it moves and not a changed label, so
        // the bar's description in the label went unspoken (2026-10-05).
        aria-label={`Across the take, ${count === 1 ? '1 bar' : `${count} bars`}`}
        aria-valuetext={current ? `${name} ${current.measure}: ${describe(current)}` : undefined}
        aria-valuemin={1}
        aria-valuemax={count}
        // Nothing picked is no value, not a value below the minimum.
        aria-valuenow={at >= 0 ? at + 1 : undefined}
        focusable
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          go(live.current, { by: event.nativeEvent.actionName === 'increment' ? 1 : -1 })
        }
        {...pan.panHandlers}
      >
        <TrendPlot
          data={data}
          height={HEIGHT}
          ends={ends}
          centreLabel={data.centreLabel}
          selected={selectedPoint}
          rail={{
            span:
              spanFrom >= 0 && spanTo >= spanFrom
                ? { from: alongOf(spanFrom), to: alongOf(spanTo) }
                : null,
            marks,
          }}
        />
      </View>
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
/** Page Up and Page Down move a phrase at a time. */
const PHRASE = 4;

function go(
  {
    measures,
    at,
    onSelect,
  }: { measures: readonly MeasureVerdict[]; at: number; onSelect: (measure: number) => void },
  move: SliderMove,
) {
  const next = measures[moveIndex(at, measures.length, move)];
  if (next) onSelect(next.measure);
}

const styles = StyleSheet.create({
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
