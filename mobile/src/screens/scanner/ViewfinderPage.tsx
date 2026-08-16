import { StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import type { ThumbnailSource } from '../../data/types';
import { colors, radii, spacing } from '../../design';

/** Corner bracket length, in points. */
const CORNER = 26;
const CORNER_WEIGHT = 2;

export interface ViewfinderPageProps {
  /** The image the next capture will produce. */
  source: ThumbnailSource;
}

/**
 * Stands in for the camera feed.
 *
 * Shows the exact image the next capture will produce, through the same
 * component and fit the captured-page thumbnails use — so what sits inside
 * the framing guide is what comes back on the review screen.
 */
export function ViewfinderPage({ source }: ViewfinderPageProps) {
  return (
    <View style={styles.frame}>
      <ScoreThumbnail
        source={source}
        radius={radii.sm}
        style={styles.page}
      />

      {/* Framing guide: four plain brackets, nothing that pulses or glows.
          They sit on the dark ground just outside the page — drawn on the
          page itself, a warm-white guide on warm-white paper disappears. */}
      <View style={[styles.corner, styles.topLeft]} />
      <View style={[styles.corner, styles.topRight]} />
      <View style={[styles.corner, styles.bottomLeft]} />
      <View style={[styles.corner, styles.bottomRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '82%',
    // Close to A4 portrait, which is what most sheet music is.
    aspectRatio: 0.74,
    padding: spacing.md,
  },
  page: {
    flex: 1,
    width: '100%',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: colors.actionText,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WEIGHT,
    borderLeftWidth: CORNER_WEIGHT,
    borderTopLeftRadius: radii.sm,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WEIGHT,
    borderRightWidth: CORNER_WEIGHT,
    borderTopRightRadius: radii.sm,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WEIGHT,
    borderLeftWidth: CORNER_WEIGHT,
    borderBottomLeftRadius: radii.sm,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WEIGHT,
    borderRightWidth: CORNER_WEIGHT,
    borderBottomRightRadius: radii.sm,
  },
});
