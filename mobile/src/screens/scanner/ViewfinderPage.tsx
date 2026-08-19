import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '../../design';

/** Corner bracket length, in points. */
const CORNER = 26;
const CORNER_WEIGHT = 2;

export interface ViewfinderPageProps {
  /** The camera preview, or whatever stands in for it. */
  children: ReactNode;
}

/**
 * The framing guide the page is lined up inside.
 *
 * **It used to be the camera.** This component held a bundled image and the
 * docstring said it "stands in for the camera feed" — so the scanner showed the
 * same four repo fixtures to everyone, and the shutter appended one of them
 * regardless of what the phone was pointed at. The frame is all that remains
 * of that: it now wraps a real preview, and the geometry is unchanged so the
 * composition the owner approved survives the swap.
 */
export function ViewfinderPage({ children }: ViewfinderPageProps) {
  return (
    <View style={styles.frame}>
      <View style={styles.page}>{children}</View>

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
    borderRadius: radii.sm,
    // The preview is a child that doesn't know about the radius, so the frame
    // does the clipping.
    overflow: 'hidden',
    backgroundColor: colors.actionBg,
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
