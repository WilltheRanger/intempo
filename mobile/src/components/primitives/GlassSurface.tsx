import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../../design';

/**
 * How hard the blur behind a glass surface is.
 *
 * `expo-blur`'s scale is 0–100 and is not linear with a CSS blur radius, so
 * this is tuned by eye against the one thing that matters: engraved notation
 * passing underneath has to become a wash rather than words you can still
 * read. Anything much lower and the surface reads as a tinted pane with legible
 * text showing through, which is clutter rather than depth.
 */
const BLUR_INTENSITY = 46;

/** This RN version's `StyleSheet` types omit `absoluteFillObject`. */
const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

export interface GlassSurfaceProps {
  children?: ReactNode;
  /**
   * Corner radius. Passed explicitly rather than inherited, because the blur
   * and the two edge layers all have to be clipped to the same curve and
   * `borderRadius: 'inherit'` does not exist in React Native.
   */
  radius: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The floating control layer: a blurred, tinted surface with a bright edge over
 * a darker separation.
 *
 * **Only chrome may use this.** Navigation, toolbars and the tab bar — never
 * content. That restriction is Apple's and it is also what keeps this app
 * recognisable: the paper, the engraving and the type stay on an opaque content
 * layer, and glass is the thing floating above them.
 *
 * **It degrades to an opaque surface, deliberately and everywhere.** `BlurView`
 * is a real blur on iOS and on the web build (`backdrop-filter`), and on
 * Android it is a semi-transparent view. `glassTint` is opaque enough that the
 * result is a legitimate solid bar wherever the blur does not land, so no
 * caller has to ask whether glass is available. That is the standing cost of
 * adopting this material — every glass surface needs a non-glass design that
 * stands on its own — and paying it here once is what stops it being paid badly
 * in each screen.
 */
export function GlassSurface({ children, radius, style }: GlassSurfaceProps) {
  return (
    <View style={[styles.container, { borderRadius: radius }, style]}>
      <BlurView
        intensity={BLUR_INTENSITY}
        tint="light"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/*
        The tint sits *above* the blur, not as the blur's own background: the
        label's legibility depends on this layer and nothing else, so it must
        not be something a platform's blur implementation can decide to skip.
      */}
      <View
        style={[styles.tint, { borderRadius: radius }]}
        pointerEvents="none"
      />
      {/*
        Two edges, always together. The bright one catches light and disappears
        over pale content; the dark one separates the shape and disappears over
        dark content. Either alone leaves the surface invisible against half of
        what can scroll under it.
      */}
      <View
        style={[styles.separator, { borderRadius: radius }]}
        pointerEvents="none"
      />
      <View
        style={[styles.edge, { borderRadius: radius }]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Clipping is what makes the blur follow the capsule instead of filling its
    // bounding box. On Android `overflow: 'hidden'` is also what lets the
    // radius apply to a child at all.
    overflow: 'hidden',
  },
  tint: {
    ...FILL,
    backgroundColor: colors.glassTint,
  },
  separator: {
    ...FILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassSeparator,
  },
  edge: {
    ...FILL,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.glassEdge,
    // Only the top edge on native: React Native cannot draw a gradient border,
    // so a full ring of the bright colour reads as an outline rather than as
    // light catching one side. The web build adds the sides back below, where a
    // gradient is available.
    ...Platform.select({
      web: {
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: colors.glassEdge,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: colors.glassEdge,
      },
      default: {},
    }),
  },
});
