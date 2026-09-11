import type { Palette } from '../../design/colors';

/**
 * Which of the glass layers a surface draws, and on what ground.
 *
 * This is a rule, so it lives in a module with tests rather than as a ternary
 * inside `GlassSurface.tsx` — there is no React Native testing library here, so
 * a rule in a `.tsx` is a rule nothing checks (`CLAUDE.md` §3).
 *
 * Liquid Glass is described as layers that add up to more than their sum:
 * diffusion, refraction, tint, specular light-play, and the two hairlines that
 * keep the shape readable. Turning the material off is therefore not "hide the
 * blur" — it is deciding, layer by layer, which of them still mean anything
 * once the surface is opaque.
 */
export interface GlassMaterial {
  /**
   * The blur behind the surface — `BlurView` on native, `backdrop-filter` on
   * the web. The first thing to go: it is the translucency itself.
   */
  diffusion: boolean;
  /**
   * The lens. Only ever meaningful with diffusion, since it bends a backdrop
   * that an opaque surface no longer shows.
   */
  refraction: boolean;
  /**
   * The specular catch. Light-play across a curved *transparent* surface.
   *
   * Off in two cases, and they are the same case twice. Over an opaque fill
   * the gradient reads as a smudge rather than as light, because there is no
   * transparent surface for light to be crossing. Over a screen's own
   * photograph it reads as a gradient laid on the picture, because the
   * photograph already has lighting of its own and this one disagrees with it
   * — a light source implied from above, over a scene lit from somewhere else.
   *
   * It is only convincing over the app's flat page, which has no light of its
   * own to contradict.
   */
  specular: boolean;
  /**
   * The darker separation ring. **Always drawn, in both materials.** It is the
   * only layer that is not an effect — it is the shape, and a control whose
   * edge you cannot find is a worse outcome than one that is not glass.
   */
  separator: boolean;
  /**
   * The bright hairline. Paired with `separator` on the translucent material,
   * because either edge alone vanishes against half of what can scroll under
   * it. That pairing is a consequence of not knowing the ground — once the
   * surface is opaque the ground is known, one dark ring is enough, and a
   * white line along the top of a solid ivory control is just a stray mark.
   */
  edge: boolean;
  /** The ground the surface paints, above the blur when there is one. */
  fill: string;
}

/**
 * The translucent material — five layers over whatever scrolls beneath.
 *
 * `overContent` changes two of them, and the surface is still glass: it still
 * blurs, still bends, and still carries both hairlines, which are the shape
 * rather than an effect.
 *
 *  - The **tint** becomes `glassTintOverContent` — lighter, not heavier; see
 *    that token for the arithmetic that set the two values apart.
 *  - The **catch goes.** See `specular` above: it implies a light source over
 *    a curved transparent surface, and a photograph is already lit from
 *    somewhere that is not there.
 */
function regular(palette: Palette, overContent: boolean): GlassMaterial {
  return {
    diffusion: true,
    refraction: true,
    specular: !overContent,
    separator: true,
    edge: true,
    fill: overContent ? palette.glassTintOverContent : palette.glassTint,
  };
}

/**
 * The fallback: a legitimate solid control, not a broken glass one.
 *
 * The fill is `glassTint` already composited over `bg`, so a bar that stops
 * being translucent does not also change colour — it stops moving. That is the
 * standing bargain of this material, and it was already being paid on Android
 * and on any browser that declines the blur; this makes the same fallback
 * reachable on purpose rather than only by accident.
 */
function opaque(palette: Palette): GlassMaterial {
  return {
    diffusion: false,
    refraction: false,
    specular: false,
    separator: true,
    edge: false,
    fill: palette.glassOpaque,
  };
}

/**
 * @param overContent true when the surface floats over a screen's own content
 * — a photograph, a viewfinder — rather than over the app's page. Ignored once
 * transparency is reduced, since an opaque fill lets nothing through either
 * way.
 * @param palette the palette this launch resolved. Passed in rather than
 * imported, for two reasons: this module stays free of `react-native` so its
 * test can load it, and the fill has to be the *running* theme's glass — dark
 * glass is a dark tint, not an inverted light one, so a hardcoded import would
 * have shipped a pale bar floating over a dark app.
 */
export function glassMaterial(
  reduceTransparency: boolean,
  palette: Palette,
  overContent = false,
): GlassMaterial {
  return reduceTransparency ? opaque(palette) : regular(palette, overContent);
}
