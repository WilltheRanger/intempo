import { describe, expect, it } from 'vitest';

import { lightColors, darkColors, type Palette } from '../../design/colors';

/**
 * Both palettes, every assertion.
 *
 * The glass tokens are the one group `audit-a11y.mjs` cannot check, because a
 * translucent surface has no fixed ground — so this file is where the material
 * is held honest, and running it against one palette would have left the dark
 * material entirely unchecked. `describe.each` rather than a copied block: two
 * copies is how the second one stops being updated.
 */
const palettes: [string, Palette][] = [
  ['light', lightColors],
  ['dark', darkColors],
];
import { glassMaterial } from './material';

/**
 * The Reduce Transparency fallback, as a rule rather than as a ternary in a
 * component nothing can render under test.
 */
describe.each(palettes)('glassMaterial (%s palette)', (_name, palette) => {
  it('draws the full stack when transparency is allowed', () => {
    const material = glassMaterial(false, palette);
    expect(material.diffusion).toBe(true);
    expect(material.refraction).toBe(true);
    expect(material.specular).toBe(true);
    expect(material.fill).toBe(palette.glassTint);
  });

  it('drops the catch over a screen\'s own content', () => {
    // The specular implies a light source above a curved transparent surface.
    // Over the flat page there is nothing to contradict it; over a photograph
    // there is — the picture is already lit, from somewhere else — and the
    // gradient reads as something laid on top rather than as light.
    expect(glassMaterial(false, palette, { overContent: true }).specular).toBe(false);
    expect(glassMaterial(false, palette, { overContent: false }).specular).toBe(true);
  });

  /**
   * **The bottom bar never takes the catch, whatever is behind it.**
   *
   * Asked for three times — "I don't really want a gradient on the bottom
   * bar", then again, then "I have told you this many times that there should
   * not be gradience on the lower bar". The first two fixes each narrowed the
   * *ground*: once for chrome over a screen's own content, once for the Today
   * photograph. Both left the catch on the bar over the Library, Insights and
   * Profile pages, which is three of the four tabs. So the rule is about the
   * surface, and this is the assertion that says so.
   */
  it('never draws the catch on the bottom bar', () => {
    expect(glassMaterial(false, palette, { bar: true }).specular).toBe(false);
    expect(
      glassMaterial(false, palette, { bar: true, overContent: true }).specular,
    ).toBe(false);
  });

  it('keeps every other layer on the bar and over content', () => {
    // Only the catch goes. It is still glass: still blurring, still bending,
    // and still carrying both hairlines, which are the shape rather than an
    // effect.
    for (const context of [{ overContent: true }, { bar: true }]) {
      const material = glassMaterial(false, palette, context);
      expect(material.diffusion).toBe(true);
      expect(material.refraction).toBe(true);
      expect(material.separator).toBe(true);
      expect(material.edge).toBe(true);
    }
  });

  it('keeps the page tint on the bar — only the catch is a bar rule', () => {
    // The bar over the app's own page is ordinary glass on an ordinary ground,
    // so it keeps `glassTint`. Over a screen's own content it still takes the
    // lighter tint, which is a fact about the ground and not about the bar.
    expect(glassMaterial(false, palette, { bar: true }).fill).toBe(palette.glassTint);
    expect(
      glassMaterial(false, palette, { bar: true, overContent: true }).fill,
    ).toBe(palette.glassTintOverContent);
  });

  it('drops every translucency effect when transparency is reduced', () => {
    const material = glassMaterial(true, palette);
    expect(material.diffusion).toBe(false);
    expect(material.refraction).toBe(false);
    expect(material.specular).toBe(false);
  });

  it('never refracts a backdrop it is not showing', () => {
    // The lens bends what the blur is sampling. Refraction without diffusion is
    // a filter over nothing, and on the web the two share one declaration.
    for (const reduced of [false, true]) {
      const material = glassMaterial(reduced, palette);
      if (material.refraction) {
        expect(material.diffusion).toBe(true);
      }
    }
  });

  it('keeps the separation ring in both materials', () => {
    // The one layer that is shape rather than effect. A control whose edge
    // cannot be found is a worse outcome than a control that is not glass.
    expect(glassMaterial(false, palette).separator).toBe(true);
    expect(glassMaterial(true, palette).separator).toBe(true);
  });

  it('pairs the bright edge with translucency only', () => {
    // Bright and dark hairlines are never used apart *while the ground is
    // unknown*. Opaque, the ground is known and the bright line is a stray
    // mark, so the pairing rule retires with the translucency that motivated it.
    expect(glassMaterial(false, palette).edge).toBe(true);
    expect(glassMaterial(true, palette).edge).toBe(false);
  });

  it('falls back to an opaque ground, not a translucent one', () => {
    const fill = glassMaterial(true, palette).fill;
    expect(fill).toBe(palette.glassOpaque);
    expect(fill).not.toMatch(/rgba/);
  });

  it('takes its own tint when it floats over a screen\'s own content', () => {
    // The one parameter of the material that depends on what is behind it.
    // Over the app's page the missing fraction is a flat colour and 0.80 was
    // chosen for a ground that could be anything; over a known dark one it can
    // afford to be lighter, and `glassTintOverContent` is. Which way round is
    // `colors.ts`'s to say — this only holds that the two are not the same
    // decision.
    expect(glassMaterial(false, palette, { overContent: true }).fill).toBe(
      palette.glassTintOverContent,
    );
    expect(glassMaterial(false, palette).fill).toBe(palette.glassTint);
    expect(palette.glassTintOverContent).not.toBe(palette.glassTint);
  });

  it('still shows the backdrop it is tinting', () => {
    // A tint that reached 1 would be an opaque bar wearing five glass layers
    // for nothing — and the whole reason the capsule floats is that content
    // passes under it.
    const alpha = Number(
      /rgba\([^)]*,\s*([0-9.]+)\s*\)/.exec(palette.glassTintOverContent)?.[1],
    );
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('lands the fallback on the colour the material settles to over the page', () => {
    // `glassOpaque` is `glassTint` composited over `bg`. Computed here rather
    // than trusted, so the two tokens cannot drift apart unnoticed — the point
    // of the fallback is that a bar stops moving without changing hue.
    const tint = palette.glassTint.match(/[\d.]+/g)!.map(Number);
    const [tr, tg, tb, alpha] = tint;
    const bg = palette.bg
      .slice(1)
      .match(/../g)!
      .map((pair) => parseInt(pair, 16));
    const composited = [tr, tg, tb].map((channel, i) =>
      Math.round(channel * alpha + bg[i] * (1 - alpha)),
    );
    const expected = `#${composited
      .map((channel) => channel.toString(16).toUpperCase().padStart(2, '0'))
      .join('')}`;
    expect(palette.glassOpaque).toBe(expected);
  });
});
