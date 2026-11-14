import { describe, expect, it } from 'vitest';

import {
  BACK,
  BACK_TITLE_MAX,
  NAV_BAR_HEIGHT,
  SCROLL_EDGE,
  backAccessibilityLabel,
  backLabel,
  barAppearance,
  sameAppearance,
} from './navigationBar';

describe('the back button’s word', () => {
  it('repeats a short previous title, as iOS does', () => {
    expect(backLabel('Library')).toBe('Library');
    expect(backLabel('Your takes')).toBe('Your takes');
  });

  it('says Back when the previous title would crowd the bar', () => {
    expect(backLabel('Sonata No. 1 in G minor')).toBe(BACK);
    expect(backLabel('x'.repeat(BACK_TITLE_MAX + 1))).toBe(BACK);
    expect(backLabel('x'.repeat(BACK_TITLE_MAX))).toBe('x'.repeat(BACK_TITLE_MAX));
  });

  it('names where back goes on a screen opened directly', () => {
    expect(backLabel(undefined, 'Profile')).toBe('Profile');
    expect(backLabel(null, 'Check the reading')).toBe(BACK);
  });

  it('prefers the screen underneath to the fallback', () => {
    expect(backLabel('Insights', 'Library')).toBe('Insights');
  });

  it('never shows an empty word', () => {
    expect(backLabel('   ', '')).toBe(BACK);
    expect(backLabel(undefined, undefined)).toBe(BACK);
  });

  it('measures the title as drawn, not as typed', () => {
    expect(backLabel('  Your\n takes ')).toBe('Your takes');
  });

  it('tells a screen reader where back goes, keeping the visible word in the name', () => {
    expect(backAccessibilityLabel('Library')).toBe('Back to Library');
    expect(backAccessibilityLabel(BACK)).toBe('Back');
  });
});

describe('the bar over a page', () => {
  const page = { overlap: NAV_BAR_HEIGHT, titleBottom: 120, darkBottom: null };

  it('is clear at rest, with no title', () => {
    expect(barAppearance({ ...page, scrollY: 0 })).toEqual({
      solid: false,
      showTitle: false,
      tone: 'auto',
    });
  });

  it('stays clear while pulled down past the top', () => {
    expect(barAppearance({ ...page, scrollY: -40 }).solid).toBe(false);
  });

  it('draws its ground as soon as content passes under it', () => {
    expect(barAppearance({ ...page, scrollY: SCROLL_EDGE - 0.5 }).solid).toBe(false);
    expect(barAppearance({ ...page, scrollY: SCROLL_EDGE }).solid).toBe(true);
  });

  it('takes the title only once the large title has gone under it', () => {
    // The large title's bottom passes the bar's bottom at 120 - 44 = 76.
    expect(barAppearance({ ...page, scrollY: 75 }).showTitle).toBe(false);
    expect(barAppearance({ ...page, scrollY: 76 }).showTitle).toBe(true);
  });

  it('shows its title as soon as it is solid on a screen with no large title', () => {
    expect(barAppearance({ ...page, titleBottom: null, scrollY: 0 }).showTitle).toBe(false);
    expect(barAppearance({ ...page, titleBottom: null, scrollY: 10 }).showTitle).toBe(true);
  });
});

describe('the bar over a photograph', () => {
  // A band 300pt tall running under a 47pt status bar and the 44pt bar.
  const band = { overlap: 47 + NAV_BAR_HEIGHT, titleBottom: 200, darkBottom: 300 };

  it('is clear, in ivory, while the band is under it', () => {
    expect(barAppearance({ ...band, scrollY: 0 })).toEqual({
      solid: false,
      showTitle: false,
      tone: 'onDark',
    });
    expect(barAppearance({ ...band, scrollY: 208 }).tone).toBe('onDark');
  });

  it('keeps the title off the band even after the large title has gone', () => {
    expect(barAppearance({ ...band, scrollY: 150 }).showTitle).toBe(false);
  });

  it('turns to paper, in ink, with the title, once the band has gone under it', () => {
    expect(barAppearance({ ...band, scrollY: 209 })).toEqual({
      solid: true,
      showTitle: true,
      tone: 'auto',
    });
  });
});

describe('comparing appearances', () => {
  it('treats equal fields as the same bar', () => {
    const a = barAppearance({ scrollY: 0, overlap: 44, titleBottom: 90, darkBottom: null });
    const b = barAppearance({ scrollY: 0.2, overlap: 44, titleBottom: 90, darkBottom: null });
    const c = barAppearance({ scrollY: 30, overlap: 44, titleBottom: 90, darkBottom: null });
    expect(sameAppearance(a, b)).toBe(true);
    expect(sameAppearance(a, c)).toBe(false);
  });
});
