import { BlurView } from 'expo-blur';
import { useId, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '../../design';
import { cssLens } from '../../lib/glass/lensFilter';
import { glassMaterial } from '../../lib/glass/material';
import { useReducedTransparency } from '../../lib/glass/reducedTransparency';

/**
 * How hard the blur behind a glass surface is.
 *
 * Tuned against the one thing that decides it: engraved notation passing
 * underneath has to become a wash rather than words you can still read. It was
 * 46, which left staff lines and titles legible through the bar — "too clear".
 */
const BLUR_INTENSITY = 68;

/** The web build's equivalent, plus the saturation lift a real blur gives. */
const WEB_DIFFUSION = 'blur(30px) saturate(150%)';

/** This RN version's `StyleSheet` types omit `absoluteFillObject`. */
const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

export interface GlassSurfaceProps {
  children?: ReactNode;
  /**
   * Corner radius. Passed explicitly rather than inherited, because the blur
   * and every overlay have to be clipped to the same curve and
   * `borderRadius: 'inherit'` does not exist in React Native.
   */
  radius: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The floating control layer: refracted, diffused, tinted, with a specular
 * catch over a darker separation.
 *
 * **Colourless, and only chrome may use it.** There was a tinted `prominent`
 * tone for primary actions; it is gone. A translucent ground picks up whatever
 * scrolls beneath it, so the one control on a screen that should not be
 * negotiable was never quite the same colour twice. Primary actions are solid
 * ink, and this material is what they sit on top of.
 *
 * **Only chrome may use this.** Navigation, toolbars, buttons, floating panels
 * — never content. That is Apple's own rule and it is what keeps this app
 * recognisable: the paper, the engraving and the type stay on an opaque content
 * layer, and glass is the thing floating above them.
 *
 * Five layers, and each one is doing a job the others cannot:
 *
 * 1. **Diffusion + refraction.** On the web these are a single `backdrop-filter`
 *    value, because sibling backdrop filters do not stack — a second one layered
 *    on top samples the original backdrop and paints a sharp copy over the
 *    blurred one. On native it is `BlurView`, which is `UIVisualEffectView`:
 *    diffusion without refraction until `expo-glass-effect` (iOS 26+) is
 *    adopted.
 * 2. **Tint**, above the blur rather than as its background, because the
 *    label's legibility depends on this layer alone and it must not be
 *    something a platform's blur implementation can decide to skip.
 * 3. **Specular** — a gradient catch, brightest at the top-left.
 * 4. **Separation** — a darker hairline ring, so the shape survives over pale
 *    content.
 * 5. **Edge** — the bright hairline, so it survives over dark content.
 *
 * Either edge alone leaves the surface invisible against half of what can
 * scroll under it, which is why they are never used apart — while the ground is
 * unknown. Opaque, it is known, and `glassMaterial` drops the bright one.
 *
 * **It degrades to an opaque surface, deliberately and everywhere.** Android
 * gets a semi-transparent view, Safari and Firefox get diffusion without
 * refraction, and the tints are opaque enough that the result is a legitimate
 * solid control wherever none of it lands. That is the standing cost of this
 * material — every glass surface needs a non-glass design that stands on its
 * own — and paying it once here is what stops it being paid badly per screen.
 *
 * **Reduce Transparency reaches the same fallback on purpose.** A system bar
 * adapts to that setting by itself; this is a custom element, so the adaptation
 * is ours to write, and until now the setting was inert on every surface the
 * app draws. Which layers survive is `glassMaterial` — a rule in a module with
 * tests, because there is no React Native testing library here and a rule
 * inside a `.tsx` is a rule nothing checks.
 */
export function GlassSurface({ children, radius, style }: GlassSurfaceProps) {
  // Gradient ids are document-global, so two surfaces on one screen would
  // otherwise share — and fight over — the same definition.
  const gradientId = `glass-spec-${useId()}`;
  const material = glassMaterial(useReducedTransparency());

  return (
    <View style={[styles.container, { borderRadius: radius }, style]}>
      {material.diffusion &&
        (Platform.OS === 'web' ? (
          <View
            style={[
              FILL,
              { borderRadius: radius },
              webBackdrop(material.refraction),
            ]}
            pointerEvents="none"
          />
        ) : (
          <BlurView
            intensity={BLUR_INTENSITY}
            tint="light"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ))}

      <View
        style={[
          FILL,
          {
            borderRadius: radius,
            backgroundColor: material.fill,
          },
        ]}
        pointerEvents="none"
      />

      {material.specular && (
        <Svg style={FILL} pointerEvents="none">
          <Defs>
            {/* Diagonal, so the catch falls across the surface rather than
                banding evenly down it. */}
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0.5" y2="1">
              <Stop offset="0" stopColor={colors.glassSpecular} stopOpacity="1" />
              <Stop offset="0.38" stopColor={colors.glassSpecular} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" rx={radius} fill={`url(#${gradientId})`} />
        </Svg>
      )}

      {material.separator && (
        <View
          style={[FILL, styles.separator, { borderRadius: radius }]}
          pointerEvents="none"
        />
      )}
      {material.edge && (
        <View
          style={[
            FILL,
            styles.edge,
            {
              borderRadius: radius,
              borderTopColor: colors.glassEdge,
            },
          ]}
          pointerEvents="none"
        />
      )}

      {children}
    </View>
  );
}

/**
 * The web build's backdrop, with refraction in the same declaration as the
 * blur — see `lensFilter.ts` for why that is not optional.
 */
function webBackdrop(refraction: boolean): ViewStyle {
  const lens = refraction ? cssLens() : null;
  const value = lens ? `${lens} ${WEB_DIFFUSION}` : WEB_DIFFUSION;
  return {
    backdropFilter: value,
    WebkitBackdropFilter: value,
  } as unknown as ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    // Clipping is what makes the blur follow the capsule instead of filling its
    // bounding box. On Android it is also what lets the radius apply to a child.
    overflow: 'hidden',
  },
  separator: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassSeparator,
  },
  edge: {
    borderTopWidth: StyleSheet.hairlineWidth,
    // Sides only on the web build: React Native cannot draw a gradient border,
    // so a full ring of the bright colour reads as an outline rather than as
    // light catching one side of a curve.
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
