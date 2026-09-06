import { describe, expect, it } from 'vitest';

import { colors } from '../../design/colors';
import { glassMaterial } from './material';

/**
 * The Reduce Transparency fallback, as a rule rather than as a ternary in a
 * component nothing can render under test.
 */
describe('glassMaterial', () => {
  it('draws the full stack when transparency is allowed', () => {
    const material = glassMaterial(false);
    expect(material.diffusion).toBe(true);
    expect(material.refraction).toBe(true);
    expect(material.specular).toBe(true);
    expect(material.fill).toBe(colors.glassTint);
  });

  it('drops every translucency effect when transparency is reduced', () => {
    const material = glassMaterial(true);
    expect(material.diffusion).toBe(false);
    expect(material.refraction).toBe(false);
    expect(material.specular).toBe(false);
  });

  it('never refracts a backdrop it is not showing', () => {
    // The lens bends what the blur is sampling. Refraction without diffusion is
    // a filter over nothing, and on the web the two share one declaration.
    for (const reduced of [false, true]) {
      const material = glassMaterial(reduced);
      if (material.refraction) {
        expect(material.diffusion).toBe(true);
      }
    }
  });

  it('keeps the separation ring in both materials', () => {
    // The one layer that is shape rather than effect. A control whose edge
    // cannot be found is a worse outcome than a control that is not glass.
    expect(glassMaterial(false).separator).toBe(true);
    expect(glassMaterial(true).separator).toBe(true);
  });

  it('pairs the bright edge with translucency only', () => {
    // Bright and dark hairlines are never used apart *while the ground is
    // unknown*. Opaque, the ground is known and the bright line is a stray
    // mark, so the pairing rule retires with the translucency that motivated it.
    expect(glassMaterial(false).edge).toBe(true);
    expect(glassMaterial(true).edge).toBe(false);
  });

  it('falls back to an opaque ground, not a translucent one', () => {
    const fill = glassMaterial(true).fill;
    expect(fill).toBe(colors.glassOpaque);
    expect(fill).not.toMatch(/rgba/);
  });

  it('lands the fallback on the colour the material settles to over the page', () => {
    // `glassOpaque` is `glassTint` composited over `bg`. Computed here rather
    // than trusted, so the two tokens cannot drift apart unnoticed — the point
    // of the fallback is that a bar stops moving without changing hue.
    const tint = colors.glassTint.match(/[\d.]+/g)!.map(Number);
    const [tr, tg, tb, alpha] = tint;
    const bg = colors.bg
      .slice(1)
      .match(/../g)!
      .map((pair) => parseInt(pair, 16));
    const composited = [tr, tg, tb].map((channel, i) =>
      Math.round(channel * alpha + bg[i] * (1 - alpha)),
    );
    const expected = `#${composited
      .map((channel) => channel.toString(16).toUpperCase().padStart(2, '0'))
      .join('')}`;
    expect(colors.glassOpaque).toBe(expected);
  });
});
