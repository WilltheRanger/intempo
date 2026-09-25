import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '../../components/primitives/Text';
import { colors } from '../../design';
import type { TempoScale as TempoScaleData } from '../../lib/verdict/barTempo';

const TRACK = 2;
const FILL = 4;
const NOTCH = 14;
const DOT = 12;
/** Room above and below the track for the notch and the dot. */
const PLOT_HEIGHT = 16;
/** A label's box, centred on its point. */
const LABEL_WIDTH = 40;

export interface TempoScaleProps {
  scale: TempoScaleData;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The bar card's picture: the musician's tempo as a notch in the middle, the
 * bar's as a dot, slower to the left and faster to the right, the stretch
 * between in the bar's colour — with each number under its mark, so the
 * picture reads without a legend (`lib/verdict/barTempo.tempoScale`).
 *
 * "slower" and "faster" at the ends name the direction once; they are the
 * only words, and a scale with no direction on it is what the owner could not
 * read (2026-09-25).
 */
export function TempoScale({ scale, accessibilityLabel, style }: TempoScaleProps) {
  const tone = colors[scale.tone];
  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Text variant="metadataSmall" color="textTertiary" style={styles.end}>
        slower
      </Text>

      <View style={styles.scale}>
        <View style={styles.plot}>
          <View style={styles.track} />
          <View
            style={[
              styles.fill,
              {
                left: `${scale.from * 100}%`,
                width: `${(scale.to - scale.from) * 100}%`,
                backgroundColor: tone,
              },
            ]}
          />
          <View style={styles.notch} />
          <View
            style={[styles.dot, { left: `${scale.at * 100}%`, backgroundColor: tone }]}
          />
        </View>

        <View style={styles.labels}>
          <Text
            variant="metadataSmall"
            color="textSecondary"
            style={[styles.label, { left: '50%' }]}
          >
            {scale.targetLabel}
          </Text>
          {scale.playedLabel ? (
            <Text
              variant="metadataSmall"
              color={scale.tone}
              style={[styles.label, { left: `${scale.at * 100}%` }]}
            >
              {scale.playedLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <Text variant="metadataSmall" color="textTertiary" style={styles.end}>
        faster
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  end: {
    // Level with the track, not with the labels under it.
    lineHeight: PLOT_HEIGHT,
  },
  scale: {
    flex: 1,
  },
  plot: {
    height: PLOT_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    height: TRACK,
    backgroundColor: colors.border,
  },
  fill: {
    position: 'absolute',
    top: (PLOT_HEIGHT - FILL) / 2,
    height: FILL,
  },
  notch: {
    position: 'absolute',
    left: '50%',
    top: (PLOT_HEIGHT - NOTCH) / 2,
    width: 2,
    height: NOTCH,
    marginLeft: -1,
    backgroundColor: colors.textSecondary,
  },
  dot: {
    position: 'absolute',
    top: (PLOT_HEIGHT - DOT) / 2,
    width: DOT,
    height: DOT,
    marginLeft: -DOT / 2,
    borderRadius: DOT / 2,
    // A ring of the card's own colour, so the dot sits clear of the fill.
    borderWidth: 2,
    borderColor: colors.surface,
  },
  labels: {
    height: 18,
    marginTop: 2,
  },
  label: {
    position: 'absolute',
    width: LABEL_WIDTH,
    marginLeft: -LABEL_WIDTH / 2,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
