import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { Text } from '../../components/primitives';
import type { MeasureVerdict, TempoBeatUnit, Tolerance } from '../../data/types';
import { BORDER_WIDTH, colors } from '../../design';
import { chartBarWidth } from '../../lib/chartBars';
import { barTempo, tempoChartBars } from '../../lib/verdict/barTempo';
import { barIndexAt, measureChartBars, type ChartBar } from '../../lib/verdict/measureChart';
import { readMeasure } from '../../lib/verdict/measureReading';

const HEIGHT = 68;
const HALF = HEIGHT / 2;

/**
 * "Measure by measure" as one chart (`redesign/Verdict.dc.html`): a bar per
 * measure on a centre rule, up for ahead and down for behind, in the measure's
 * verdict colour. The selected measure is outlined, and opens underneath.
 *
 * **The whole strip answers the finger**, not each bar: on a sixty-bar piece a
 * bar is three points wide, and no one can hit that. A tap or a drag lands on
 * the bar under it (`barIndexAt`), so the chart can be scrubbed.
 *
 * To assistive tech it is one slider — "Measure 17 of 24: Rushing" —
 * stepping a measure at a time, rather than sixty unlabelled shapes; on the
 * web the arrow keys step it, as they do `TempoSlider`.
 */
export function MeasureBars({
  measures,
  selected,
  onSelect,
  targetBpm,
  tempoBeatUnit,
  tolerance,
}: {
  measures: MeasureVerdict[];
  selected: number | null;
  onSelect: (measure: number) => void;
  /**
   * The take's target, so each bar can be drawn by its tempo against it
   * (`lib/verdict/barTempo.ts`); an older result without tempi draws the
   * deviation chart it always did.
   */
  targetBpm: number;
  tempoBeatUnit: TempoBeatUnit | null | undefined;
  tolerance: Tolerance | null;
}) {
  const bars = useMemo(
    () =>
      tempoChartBars(measures, targetBpm, tempoBeatUnit, tolerance) ??
      measureChartBars(measures),
    [measures, targetBpm, tempoBeatUnit, tolerance],
  );
  const [width, setWidth] = useState(0);

  const node = useRef<View>(null);
  const at = bars.findIndex((bar) => bar.measure === selected);
  const live = useRef({ width, bars, onSelect, at });
  live.current = { width, bars, onSelect, at };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (event) => pick(event.nativeEvent.locationX),
        onPanResponderMove: (event) => pick(event.nativeEvent.locationX),
      }),
    [],
  );
  function pick(x: number) {
    const { width: w, bars: b, onSelect: select } = live.current;
    const index = barIndexAt(x, w, b.length);
    if (index !== null) select(b[index].measure);
  }

  // Arrow keys on the web, on the DOM node react-native-web renders — React
  // Native has no keyboard prop for a plain view.
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    const element = node.current as unknown as HTMLElement | null;
    if (!element?.addEventListener) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        stepFrom(live.current, 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        stepFrom(live.current, -1);
      }
    }
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  }, []);

  function handleLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  }

  const step = bars.length > 0 ? width / bars.length : 0;
  const barWidth = chartBarWidth(step);
  const current = at >= 0 ? measures[at] : null;

  return (
    <View>
      <View
        ref={node}
        style={styles.chart}
        onLayout={handleLayout}
        role="slider"
        aria-label={
          current
            ? `Bar ${current.measure} of ${bars.length}: ${
                barTempo(current, targetBpm, tempoBeatUnit, tolerance)?.spoken ??
                readMeasure(current).label
              }`
            : 'Bar by bar'
        }
        aria-valuemin={1}
        aria-valuemax={bars.length}
        aria-valuenow={at + 1}
        focusable
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          stepFrom(live.current, event.nativeEvent.actionName === 'increment' ? 1 : -1)
        }
        {...pan.panHandlers}
      >
        <View style={styles.rule} pointerEvents="none" />
        {step > 0
          ? bars.map((bar, index) => {
              const left = index * step + (step - barWidth) / 2;
              const height = Math.max(2, bar.size * (HALF - 4));
              return (
                // A Fragment, not a wrapping View: the bars are positioned
                // against the chart, and a static wrapper is a zero-height box
                // that `bottom: HALF` would resolve against instead.
                <Fragment key={bar.measure}>
                  {index === at ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.outline,
                        { left: left - 3, width: barWidth + 6 },
                      ]}
                    />
                  ) : null}
                  <View
                    pointerEvents="none"
                    style={[
                      styles.bar,
                      {
                        left,
                        width: barWidth,
                        height,
                        backgroundColor: bar.tone ? colors[bar.tone] : colors.chartRule,
                      },
                      bar.up ? { bottom: HALF } : { top: HALF },
                    ]}
                  />
                </Fragment>
              );
            })
          : null}
      </View>
      <View style={styles.ends}>
        <Text variant="caption" color="textTertiary" style={styles.number}>
          Bar {bars[0]?.measure ?? ''}
        </Text>
        <Text variant="caption" color="textTertiary" style={styles.number}>
          {bars[bars.length - 1]?.measure ?? ''}
        </Text>
      </View>
    </View>
  );
}

/** Select the bar `delta` along from the selected one, clamped at the ends. */
function stepFrom(
  { bars, at, onSelect }: { bars: ChartBar[]; at: number; onSelect: (measure: number) => void },
  delta: number,
) {
  const next = bars[Math.max(0, Math.min(bars.length - 1, (at < 0 ? 0 : at) + delta))];
  if (next) onSelect(next.measure);
}

const styles = StyleSheet.create({
  chart: {
    height: HEIGHT,
  },
  rule: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: HALF,
    height: BORDER_WIDTH,
    backgroundColor: colors.chartRule,
  },
  bar: {
    position: 'absolute',
    borderRadius: 2,
  },
  outline: {
    position: 'absolute',
    top: -4,
    bottom: -4,
    height: HEIGHT + 8,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.chartRule,
    borderRadius: 4,
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  number: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
});
