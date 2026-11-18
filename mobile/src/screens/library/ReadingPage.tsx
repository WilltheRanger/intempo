import { Animated, StyleSheet, View } from 'react-native';

import { usePulse } from '../../components/primitives/Skeleton';
import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, spacing } from '../../design';

/** Five lines to a stave, and as many staves as a tile's page holds with room. */
const STAFF_LINES = 5;
const STAVES = 4;

/**
 * A page while it is being read: faint staves on the photograph's paper, and
 * the reading's own step under them (`readingLine`).
 *
 * **It was a white tile with grey words**, "Reading the page…", which on a
 * shelf of engraved pages read as an image that had failed to load (the UI
 * review, 2026-11-12). `paper` and `photoRule` are the colours the app already
 * gives a page before it has been read — the onboarding's scan illustration
 * draws one — so the shelf now shows the same thing: the page, waiting for its
 * notes.
 *
 * The staves pulse as a skeleton does (`usePulse`), so the tile reads as
 * coming rather than broken; the words hold still, so they can be read. The
 * staves are decoration and hidden from a screen reader, which hears the line
 * in the tile's own label.
 */
export function ReadingPage({ line }: { line: string }) {
  const pulse = usePulse();
  return (
    <View style={styles.page}>
      <Animated.View style={[styles.staves, pulse]} aria-hidden>
        {Array.from({ length: STAVES }, (_, stave) => (
          <View key={stave} style={styles.stave}>
            {Array.from({ length: STAFF_LINES }, (_, line) => (
              <View key={line} style={styles.line} />
            ))}
          </View>
        ))}
      </Animated.View>
      <Text
        variant="metadataSmall"
        color="textTertiary"
        numberOfLines={2}
        style={styles.caption}
        accessible={false}
      >
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The page's own paper, edge to edge inside the tile's frame.
  page: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.paper,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  staves: {
    flex: 1,
    justifyContent: 'space-evenly',
  },
  stave: {
    gap: spacing.xs,
  },
  line: {
    height: BORDER_WIDTH,
    backgroundColor: colors.photoRule,
  },
  caption: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
