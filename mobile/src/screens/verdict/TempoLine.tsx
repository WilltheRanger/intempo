import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { tempoY, type TempoLineData } from '../../lib/verdict/barTempo';

const HEIGHT = 96;
const VIEW_WIDTH = 300;

/** Room for a tempo label, "104", beside the plot. */
const GUTTER = 40;

/** A label's own height, so one centred on its value stays inside the chart. */
const LABEL_HEIGHT = 16;

export interface TempoLineProps {
  line: TempoLineData;
  /** Measure numbers at each end, so the x axis reads as the take. */
  firstMeasure: number;
  lastMeasure: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * "Across the take" in BPM: the tempo each bar was played at, against a
 * hairline at the tempo the musician set (`lib/verdict/barTempo.ts`).
 *
 * It replaces a line of drift from the target held since the first note,
 * which a steadily slower take grows without bound — the owner's first
 * working take sat on the chart's floor from bar 2 (2026-09-25).
 *
 * The axis names three numbers at most: the target, on its rule, and the
 * take's own fastest and slowest where they would not crowd it. No grid: the
 * question is where the take sat against the tempo set, and when.
 */
export function TempoLine({
  line,
  firstMeasure,
  lastMeasure,
  accessibilityLabel,
  style,
}: TempoLineProps) {
  // The target as steps: flat for a piece that never changes tempo, stepping
  // where the page sets a new one ("meno mosso", a new metronome mark).
  const targetPoints = line.steps
    .flatMap((step) => {
      const y = tempoY(step.bpm, line, HEIGHT).toFixed(1);
      return [`${(step.from * VIEW_WIDTH).toFixed(1)},${y}`, `${(step.to * VIEW_WIDTH).toFixed(1)},${y}`];
    })
    .join(' ');

  return (
    <View style={style}>
      <View
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={styles.plotRow}
      >
        <View style={styles.gutter}>
          {line.ticks.map((tick) => (
            <Text
              key={tick.label}
              variant="metadataSmall"
              color={tick.isTarget ? 'textSecondary' : 'textTertiary'}
              style={[
                styles.tick,
                {
                  top: Math.max(
                    0,
                    Math.min(
                      HEIGHT - LABEL_HEIGHT,
                      tempoY(tick.bpm, line, HEIGHT) - LABEL_HEIGHT / 2,
                    ),
                  ),
                },
              ]}
            >
              {tick.label}
            </Text>
          ))}
        </View>

        <View style={styles.plot}>
          <Svg
            width="100%"
            height={HEIGHT}
            viewBox={`0 0 ${VIEW_WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
          >
            <Polyline
              points={targetPoints}
              fill="none"
              stroke={colors.chartRule}
              strokeWidth={BORDER_WIDTH}
              vectorEffect="non-scaling-stroke"
            />
            {line.runs.map((run) => (
              <Polyline
                key={run[0].measure}
                points={run
                  .map(
                    (point) =>
                      `${(point.at * VIEW_WIDTH).toFixed(1)},${tempoY(point.bpm, line, HEIGHT).toFixed(1)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                // Set in user units against a stretched viewBox, so without
                // this the stroke thickens horizontally as the container widens.
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </Svg>
        </View>
      </View>

      {/* The x axis, in bar numbers that can be found in the chart below. */}
      <View style={styles.xAxis}>
        <Text variant="metadataSmall" color="textTertiary">
          Bar {firstMeasure}
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
  },
  tick: {
    position: 'absolute',
    left: 0,
    lineHeight: LABEL_HEIGHT,
    fontVariant: ['tabular-nums'],
  },
  plot: {
    flex: 1,
    height: HEIGHT,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginLeft: GUTTER,
  },
});
