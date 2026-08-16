import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';

export interface NotationPlaceholderProps {
  /** Total measures on this page. */
  measures: number;
  /** 1-based measure the playback head sits on. */
  currentMeasure: number;
}

const MEASURES_PER_STAVE = 4;
const STAVE_HEIGHT = 34;
const STAFF_LINES = 5;

/**
 * Stands in for rendered notation.
 *
 * Draws staves and barlines — the structure of the page — but no noteheads.
 * Inventing notes would claim a transcription that hasn't happened, and this
 * screen is scaffolding. What it does show honestly is where the playback head
 * is, which is the interaction being evaluated.
 */
export function NotationPlaceholder({
  measures,
  currentMeasure,
}: NotationPlaceholderProps) {
  const staveCount = Math.max(1, Math.ceil(measures / MEASURES_PER_STAVE));

  return (
    <View style={styles.container}>
      {Array.from({ length: staveCount }, (_, staveIndex) => {
        const first = staveIndex * MEASURES_PER_STAVE + 1;
        const count = Math.min(MEASURES_PER_STAVE, measures - first + 1);

        return (
          <View key={staveIndex} style={styles.staveBlock}>
            <View style={styles.stave}>
              <View style={styles.lines} pointerEvents="none">
                {Array.from({ length: STAFF_LINES }, (_, line) => (
                  <View key={line} style={styles.line} />
                ))}
              </View>

              <View style={styles.bars}>
                {Array.from({ length: count }, (_, cell) => (
                  <View
                    key={cell}
                    style={[
                      styles.bar,
                      cell === count - 1 && styles.barLast,
                    ]}
                  />
                ))}
              </View>
            </View>

            {/* Playback head, aligned to the same measure grid. */}
            <View style={styles.markers}>
              {Array.from({ length: count }, (_, cell) => (
                <View
                  key={cell}
                  style={[
                    styles.marker,
                    first + cell === currentMeasure && styles.markerActive,
                  ]}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  staveBlock: {
    gap: spacing.xs,
  },
  stave: {
    height: STAVE_HEIGHT,
    justifyContent: 'center',
  },
  lines: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'space-between',
  },
  line: {
    height: BORDER_WIDTH,
    backgroundColor: colors.borderStrong,
  },
  bars: {
    flexDirection: 'row',
    height: STAVE_HEIGHT,
  },
  bar: {
    flex: 1,
    borderRightWidth: BORDER_WIDTH,
    borderRightColor: colors.textTertiary,
  },
  barLast: {
    borderRightWidth: 0,
  },
  markers: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  marker: {
    flex: 1,
    height: 2,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
  },
  markerActive: {
    backgroundColor: colors.accent,
  },
});
