import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives';
import { BORDER_WIDTH, colors } from '../../design';
import { chartBarWidth } from '../../lib/chartBars';
import { axisLabels, plotFraction } from '../../lib/insights/sessionTrend';
import type { PassageTempo } from '../../lib/insights/passageTempo';

/** The left-hand column the axis words sit in, as the trend chart's. */
const GUTTER = 58;

/** The shortest bar drawn, so a passage on the beat is still a mark. */
const MIN_BAR = 4;

/**
 * A piece's tempo passage by passage, first bar to last
 * (`redesign/Insights.dc.html`, "Worth a look").
 *
 * A bar per passage from the target, up for faster and down for slower, over
 * the on-tempo band (`passageTempo.ts`). Gold where the passage is off the beat, the neutral `steady`
 * where it is not — so the eye goes to the passages worth practising and the
 * rest still shows the piece's whole length.
 */
export function PassageChart({
  tempo,
  accessibilityLabel,
  height = 90,
}: {
  tempo: PassageTempo;
  accessibilityLabel: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const { range, passages } = tempo;
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
        {labels.faster ? (
          <Text variant="caption" color="textTertiary" style={[styles.axis, { top: 0 }]}>
            Faster
          </Text>
        ) : null}
        <Text variant="caption" color="textTertiary" style={[styles.axis, { top: zeroY - 7 }]}>
          On tempo
        </Text>
        {labels.slower ? (
          <Text variant="caption" color="textTertiary" style={[styles.axis, { bottom: 0 }]}>
            Slower
          </Text>
        ) : null}
      </View>
      <View style={styles.ends}>
        {/*
          Each column is a passage, so each end names its passage's bars:
          "Bars 1–2 … Bars 9–10" under five columns rather than "Bar 1 … Bar 10",
          which read as ten bars drawn as five (2026-09-29).
        */}
        <Text variant="caption" color="textTertiary">
          {barsLabel(passages[0])}
        </Text>
        <Text variant="caption" color="textTertiary">
          {barsLabel(passages[passages.length - 1])}
        </Text>
      </View>
    </View>
  );
}

function barsLabel(passage: { from: number; to: number } | undefined): string {
  if (!passage) return '';
  return passage.from === passage.to ? `Bar ${passage.from}` : `Bars ${passage.from}–${passage.to}`;
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
