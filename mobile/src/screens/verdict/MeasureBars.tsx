import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { useDrawIn } from '../../components/charts/useDrawIn';
import { Text } from '../../components/primitives';
import type { MeasureVerdict, TempoBeatUnit, Tolerance } from '../../data/types';
import { BORDER_WIDTH, colors } from '../../design';
import { chartBarWidth } from '../../lib/chartBars';
import { moveIndex, sliderMove, type SliderMove } from '../../lib/sliderKeys';
import { barTempo, tempoChartBars } from '../../lib/verdict/barTempo';
import { barIndexAt, measureChartBars, type ChartBar } from '../../lib/verdict/measureChart';
import { readMeasure } from '../../lib/verdict/measureReading';

const HEIGHT = 68;
/** The dot under a bar with a mistake in it. */
const MARK = 5;
const HALF = HEIGHT / 2;
/**
 * Room at the right for what up and down mean — "faster" and "slower", or
 * "sharp" and "flat" — so the tempo and pitch readings of the chart are the
 * same width and switching between them does not move the bars.
 */
const DIRECTION_GUTTER = 50;

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
  chart,
  describe,
  name = 'Bar',
  ends,
  marked,
  span,
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
  /**
   * Other bars to draw over the same measures — "In tune"'s pitch
   * (`lib/verdict/intonation.ts`) — sharing the selection, so either chart
   * opens the same bar in the card.
   */
  chart?: ChartBar[];
  /** What a selected bar is read out as, when `chart` draws something else. */
  describe?: (measure: MeasureVerdict) => string;
  /** How the slider names a bar to assistive tech: "Bar 3 of 12", "Pitch in bar 3 of 12". */
  name?: string;
  /** What up and down mean, beside the chart — "faster" and "slower", "sharp" and "flat". */
  ends?: { up: string; down: string };
  /**
   * Bars with something else wrong in them — a note heard as another, an
   * entrance after a miscounted rest (`mistakeBars`): a dot under each. The
   * bar's card says what it was.
   */
  marked?: ReadonlySet<number>;
  /**
   * The passage the selected bar belongs to (`lib/verdict/barPassage.ts`),
   * outlined as one: a tap picks out bars 5–8, not bar 7 alone.
   */
  span?: { from: number; to: number } | null;
}) {
  const bars = useMemo(
    () =>
      chart ??
      tempoChartBars(measures, targetBpm, tempoBeatUnit, tolerance) ??
      measureChartBars(measures),
    [chart, measures, targetBpm, tempoBeatUnit, tolerance],
  );
  const [measured, setWidth] = useState(0);
  // Each bar grows from the centre rule, as the trend line draws itself in.
  const drawn = useDrawIn();
  // The bars' own width: the chart's, less the gutter its ends are named in.
  const width = Math.max(0, measured - (ends ? DIRECTION_GUTTER : 0));

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
      const move = sliderMove(event.key, { big: PHRASE });
      if (!move) return;
      event.preventDefault();
      goTo(live.current, move);
    }
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  }, []);

  function handleLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  }

  const step = bars.length > 0 ? width / bars.length : 0;
  // One outline: around the passage when there is one, else the bar alone.
  const spanFrom = span ? bars.findIndex((bar) => bar.measure === span.from) : -1;
  const spanTo = span ? bars.findIndex((bar) => bar.measure === span.to) : -1;
  const outlineFrom = spanFrom >= 0 && spanTo >= spanFrom ? spanFrom : at;
  const outlineTo = spanFrom >= 0 && spanTo >= spanFrom ? spanTo : at;
  const barWidth = chartBarWidth(step);
  const current = at >= 0 ? measures[at] : null;

  return (
    <View>
      <View
        ref={node}
        style={styles.chart}
        onLayout={handleLayout}
        role="slider"
        // The name stays; the value says where you are — see `TrendChart`.
        aria-label="Bar by bar"
        aria-valuetext={
          current
            ? `${name} ${current.measure}: ${
                describe
                  ? describe(current)
                  : (barTempo(current, targetBpm, tempoBeatUnit, tolerance)?.spoken ??
                    readMeasure(current).label)
              }${marked?.has(current.measure) ? ', and a mistake to look at' : ''}`
            : undefined
        }
        aria-valuemin={1}
        aria-valuemax={bars.length}
        // Nothing picked is no value, not 0 below a minimum of 1.
        aria-valuenow={at >= 0 ? at + 1 : undefined}
        focusable
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          goTo(live.current, { by: event.nativeEvent.actionName === 'increment' ? 1 : -1 })
        }
        {...pan.panHandlers}
      >
        <View style={[styles.rule, ends ? styles.ruleShort : null]} pointerEvents="none" />
        {ends ? (
          <>
            <Text
              variant="caption"
              color="textTertiary"
              style={[styles.direction, styles.directionUp]}
              pointerEvents="none"
            >
              {ends.up}
            </Text>
            <Text
              variant="caption"
              color="textTertiary"
              style={[styles.direction, styles.directionDown]}
              pointerEvents="none"
            >
              {ends.down}
            </Text>
          </>
        ) : null}
        {step > 0
          ? bars.map((bar, index) => {
              const left = index * step + (step - barWidth) / 2;
              const height = Math.max(2, bar.size * (HALF - 4) * drawn);
              return (
                // A Fragment, not a wrapping View: the bars are positioned
                // against the chart, and a static wrapper is a zero-height box
                // that `bottom: HALF` would resolve against instead.
                <Fragment key={bar.measure}>
                  {index === outlineFrom ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.outline,
                        {
                          left: left - 3,
                          width: (outlineTo - outlineFrom) * step + barWidth + 6,
                        },
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
      {marked && marked.size > 0 && step > 0 ? (
        // A row of its own under the chart rather than inside it, where a bar
        // drawn down to the floor would cover it.
        <View style={[styles.marks, ends ? styles.endsShort : null]} pointerEvents="none">
          {bars.map((bar, index) =>
            marked.has(bar.measure) ? (
              <View
                key={bar.measure}
                style={[styles.mark, { left: index * step + step / 2 - MARK / 2 }]}
              />
            ) : null,
          )}
        </View>
      ) : null}
      <View style={[styles.ends, ends ? styles.endsShort : null]}>
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
/** Page Up and Page Down move a phrase at a time. */
const PHRASE = 4;

function goTo(
  { bars, at, onSelect }: { bars: ChartBar[]; at: number; onSelect: (measure: number) => void },
  move: SliderMove,
) {
  const next = bars[moveIndex(at, bars.length, move)];
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
  marks: {
    height: MARK,
    marginTop: 6,
  },
  mark: {
    position: 'absolute',
    top: 0,
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    backgroundColor: colors.textSecondary,
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  endsShort: {
    marginRight: DIRECTION_GUTTER,
  },
  ruleShort: {
    right: DIRECTION_GUTTER,
  },
  direction: {
    position: 'absolute',
    right: 0,
    width: DIRECTION_GUTTER - 6,
    textAlign: 'right',
  },
  directionUp: {
    top: -2,
  },
  directionDown: {
    bottom: -2,
  },
  number: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
});
