import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';

/** Corner bracket length, in points. */
const CORNER = 26;
const CORNER_WEIGHT = 2;
const STAFF_COUNT = 8;

/**
 * Stands in for the camera feed.
 *
 * There is no camera in this build, so rather than a black rectangle or a
 * faked photograph this draws a page of ruled staves inside the framing
 * guide — enough to judge how the guide sits against sheet music. It uses the
 * same ruled-line motif as the score thumbnail placeholder.
 */
export function ViewfinderPage() {
  return (
    <View style={styles.frame}>
      <View style={styles.page}>
        {Array.from({ length: STAFF_COUNT }, (_, index) => (
          <View key={index} style={styles.stave}>
            {Array.from({ length: 5 }, (_, line) => (
              <View key={line} style={styles.staveLine} />
            ))}
          </View>
        ))}
      </View>

      {/* Framing guide: four brackets, nothing that pulses or glows. */}
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
    // Insets the page so the brackets fall on the dark ground just outside
    // it. Sitting them on the page itself makes a white guide on white paper.
    padding: spacing.md,
  },
  page: {
    flex: 1,
    backgroundColor: colors.actionText,
    borderRadius: radii.sm,
    paddingHorizontal: '9%',
    paddingVertical: '7%',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  stave: {
    justifyContent: 'space-between',
    height: '7%',
  },
  staveLine: {
    height: BORDER_WIDTH,
    backgroundColor: colors.borderStrong,
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
