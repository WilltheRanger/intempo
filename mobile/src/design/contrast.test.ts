import { describe, expect, it } from 'vitest';

import { lightColors as colors, darkColors } from './colors';

/**
 * Contrast, as arithmetic rather than as a claim in a comment.
 *
 * The verdict hues carry a comment saying they were "darkened only as far as
 * WCAG AA needed on the ivory ground", with the measurements written out. That
 * work was real and nothing checked it, so nothing would have noticed the
 * accent — used at `metadataSmall` for the playback settings, the "fix this
 * bar" cues and the clef control — sitting at **3.54:1** on the same ground.
 *
 * These are the ratios the palette is built to. A token nudged for looks now
 * fails here instead of failing quietly in someone's hands.
 */

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (at: number) => {
    const c = parseInt(value.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA: body text. */
const BODY = 4.5;
/** WCAG AA: large text, and the 1.4.11 floor for a non-text mark. */
const LARGE = 3;

describe('text on the light grounds', () => {
  const grounds = [
    ['the page', colors.bg],
    ['a card', colors.surface],
  ] as const;

  const bodyTokens = [
    ['textPrimary', colors.textPrimary],
    ['textSecondary', colors.textSecondary],
    ['textTertiary', colors.textTertiary],
    ['accentText', colors.accentText],
    ['verdictOn', colors.verdictOn],
    ['verdictMid', colors.verdictMid],
    ['verdictBad', colors.verdictBad],
  ] as const;

  for (const [groundName, ground] of grounds) {
    for (const [name, value] of bodyTokens) {
      it(`${name} reads on ${groundName}`, () => {
        expect(contrast(value, ground)).toBeGreaterThanOrEqual(BODY);
      });
    }
  }
});

describe('the accent', () => {
  it('is not used for small text on a light ground', () => {
    // **The finding this file was written for.** `accent` is a mark — a
    // progress fill, an active tab, a favourite — and clears the 3:1 that a
    // mark needs. It does not clear body text's 4.5, which is why
    // `accentText` exists.
    expect(contrast(colors.accent, colors.bg)).toBeGreaterThanOrEqual(LARGE);
    expect(contrast(colors.accent, colors.bg)).toBeLessThan(BODY);
  });

  it('reads as text on the scanner, which is the one dark screen', () => {
    // And `accentText` does not, which is why there are two tokens rather than
    // one darker accent. Both halves asserted: the reason is the pair.
    expect(contrast(colors.accent, colors.actionBg)).toBeGreaterThanOrEqual(BODY);
    expect(contrast(colors.accentText, colors.actionBg)).toBeLessThan(BODY);
  });
});

describe('chrome on the dark ground', () => {
  it('carries its own text', () => {
    expect(contrast(colors.actionText, colors.actionBg)).toBeGreaterThanOrEqual(BODY);
  });

  it('keeps its muted text readable', () => {
    // `onDarkMuted` is 55% white over the ink, which composites to about
    // #8E8C89. Asserted against the composite rather than the token, because
    // the token is an rgba string and contrast is a property of what lands on
    // the screen.
    expect(contrast('#8E8C89', colors.actionBg)).toBeGreaterThanOrEqual(BODY);
  });
});


/**
 * The dark palette, held to exactly the same arithmetic.
 *
 * Written as a loop over both palettes rather than as a second copy of the
 * light block, because two copies is how the *second* one stops being updated
 * — which is the same failure that put an SSRF in one of two twin fetch
 * functions on 2026-09-09.
 *
 * The `accent` case is the interesting one and it is asserted in both
 * directions: on ivory the brand gold misses body text and the *darker*
 * `accentText` carries it; on ink it misses body text on a card and the
 * *lighter* one carries it. Same role, opposite arithmetic, and a test that
 * only checked one ground would have let the wrong token ship.
 */
describe('every palette clears AA on its own grounds', () => {
  const palettes = [
    ['light', colors],
    ['dark', darkColors],
  ] as const;

  const bodyTokens = [
    'textPrimary',
    'textSecondary',
    'textTertiary',
    'accentText',
    'verdictOn',
    'verdictMid',
    'verdictBad',
  ] as const;

  for (const [mode, palette] of palettes) {
    for (const ground of ['bg', 'surface'] as const) {
      for (const token of bodyTokens) {
        it(`${mode}: ${token} reads as body text on ${ground}`, () => {
          expect(contrast(palette[token], palette[ground])).toBeGreaterThanOrEqual(BODY);
        });
      }

      it(`${mode}: accent clears the non-text floor on ${ground}`, () => {
        expect(contrast(palette.accent, palette[ground])).toBeGreaterThanOrEqual(LARGE);
      });

      it(`${mode}: a primary action's label reads on it`, () => {
        expect(contrast(palette.actionText, palette.actionBg)).toBeGreaterThanOrEqual(BODY);
      });
    }

    it(`${mode}: a card is a lift off the page, not a box`, () => {
      // Both palettes hold the same relationship: light 1.12:1, dark 1.14:1.
      const lift = contrast(palette.surface, palette.bg);
      expect(lift).toBeGreaterThan(1.05);
      expect(lift).toBeLessThan(1.3);
    });

    it(`${mode}: ink still reads on glass over the worst content behind it`, () => {
      // A translucent surface has no fixed ground, so the check is the
      // composite over the extremes: a page of black notation, and white paper.
      for (const behind of ['#000000', '#FFFFFF']) {
        expect(contrast(palette.textPrimary, over(palette.glassTint, behind))).toBeGreaterThanOrEqual(BODY);
      }
    });
  }
});

/** Composite an `rgba(...)` tint over an opaque hex ground. */
function over(tint: string, behind: string): string {
  const [r, g, b, a] = tint.match(/[\d.]+/g)!.map(Number);
  const channel = (at: number) => parseInt(behind.replace('#', '').slice(at, at + 2), 16);
  const mix = (fg: number, bgc: number) => Math.round(fg * a + bgc * (1 - a));
  return (
    '#' +
    [mix(r, channel(0)), mix(g, channel(2)), mix(b, channel(4))]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}
