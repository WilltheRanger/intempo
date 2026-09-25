import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives';
import { BORDER_WIDTH, colors } from '../../design';
import { chartBarWidth } from '../../lib/chartBars';
import { axisLabels, plotFraction } from '../../lib/insights/sessionTrend';
import type { PassageDrift } from '../../lib/insights/passageDrift';

/** The left-hand column the axis words sit in. */
const GUTTER = 48;

/** The shortest bar drawn, so a passage on the beat is still a mark. */
const MIN_BAR = 4;

/**
 * A piece's drift passage by passage, first bar to last
 * (`redesign/Insights.dc.html`, "Worth a look").
 *
 * A bar per passage from the beat, up for ahead and down for behind, over the
 * on-tempo band. Gold where the passage is off the beat, the neutral `steady`
 * where it is not — so the eye goes to the passages worth practising and the
 * rest still shows the piece's whole length.
 */
export function PassageChart({
  drift,
  accessibilityLabel,
  height = 90,
}: {
  drift: PassageDrift;
  accessibilityLabel: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const { range, passages } = drift;
  const yOf = (value: number) => plotFraction(value, range) * height;
  const zeroY = yOf(0);
  const plotWidth = Math.max(0, width - GUTTER);
  const slot = passages.length > 0 ? plotWidth / passages.length : 0;
  const barWidth = chartBarWidth(slot);
  const labels = axisLabels(
    passages.map((passage) => passage.value),
    range,
  );

  return (
    <View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={{ height }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <View
          style={[
            styles.band,
            { top: yOf(range.bandTop), height: Math.max(0, yOf(range.bandBottom) - yOf(range.bandTop)) },
          ]}
        />
        <View style={[styles.beat, { top: zeroY }]} />
        {slot > 0
          ? passages.map((passage, index) => {
              const size = Math.max(MIN_BAR, Math.abs(yOf(passage.value) - zeroY));
              return (
                <View
                  key={passage.from}
                  style={[
                    styles.bar,
                    {
                      left: GUTTER + index * slot + (slot - barWidth) / 2,
                      width: barWidth,
                      height: size,
                      backgroundColor: passage.off ? colors.accent : colors.steady,
                    },
                    passage.value >= 0 ? { top: zeroY - size } : { top: zeroY },
                  ]}
                />
              );
            })
          : null}
        {labels.ahead ? (
          <Text variant="caption" color="textTertiary" style={[styles.axis, { top: 0 }]}>
            Ahead
          </Text>
        ) : null}
        <Text variant="caption" color="textTertiary" style={[styles.axis, { top: zeroY - 7 }]}>
          On beat
        </Text>
        {labels.behind ? (
          <Text variant="caption" color="textTertiary" style={[styles.axis, { bottom: 0 }]}>
            Behind
          </Text>
        ) : null}
      </View>
      <View style={styles.ends}>
        <Text variant="caption" color="textTertiary">
          Bar {passages[0]?.from}
        </Text>
        <Text variant="caption" color="textTertiary">
          Bar {passages[passages.length - 1]?.to}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: GUTTER,
    right: 0,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  beat: {
    position: 'absolute',
    left: GUTTER,
    right: 0,
    height: BORDER_WIDTH,
    backgroundColor: colors.chartRule,
  },
  bar: {
    position: 'absolute',
    borderRadius: 2,
  },
  axis: {
    position: 'absolute',
    left: 0,
    // 12 is the app's smallest size (`typography.caption`).
    fontSize: 12,
    lineHeight: 16,
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
    marginLeft: GUTTER,
  },
});
