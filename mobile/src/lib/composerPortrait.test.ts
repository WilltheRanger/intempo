import { describe, expect, it } from 'vitest';

import { coverFor, PORTRAITS, portraitFor } from './composerPortrait';
import { COMPOSERS } from './composers';

describe('coverFor', () => {
  it('prefers the photograph of the page over anything else', () => {
    // **The rule that matters.** A picture of the actual page is what the
    // musician took, of the music they are working on. A portrait is
    // decoration by comparison, however handsome — so it may only ever fill a
    // hole, never replace a page.
    const cover = coverFor({ thumbnail: 'file://page.jpg', composer: 'Ludwig van Beethoven' });

    expect(cover.kind).toBe('page');
  });

  it('falls through to the ruled staff when nothing else is known', () => {
    expect(coverFor({ thumbnail: null, composer: null }).kind).toBe('staff');
    expect(coverFor({ thumbnail: null, composer: 'Anna Clyne' }).kind).toBe('staff');
  });

  it('uses a portrait for a piece with no page, when there is one', () => {
    // The table is empty today — see `composerPortrait.ts` — so this exercises
    // the seam rather than the data.
    PORTRAITS['Ludwig van Beethoven'] = { source: 'test://beethoven', focus: { x: 50, y: 30 } };
    try {
      const cover = coverFor({ thumbnail: null, composer: 'beethoven' });

      expect(cover.kind).toBe('portrait');
      expect(cover.kind === 'portrait' && cover.focus).toEqual({ x: 50, y: 30 });
    } finally {
      delete PORTRAITS['Ludwig van Beethoven'];
    }
  });
});

describe('portraitFor', () => {
  it('shares one picture across every spelling of one person', () => {
    // Half the reason `canonical` exists: four ways of writing Bach must not
    // be four covers.
    PORTRAITS['J. S. Bach'] = { source: 'test://bach', focus: { x: 50, y: 30 } };
    try {
      for (const spelling of ['J.S. Bach', 'JS Bach', 'bach', 'Johann Sebastian Bach']) {
        expect(portraitFor(spelling)?.source).toBe('test://bach');
      }
    } finally {
      delete PORTRAITS['J. S. Bach'];
    }
  });

  it('is null for an unknown composer, and for none', () => {
    expect(portraitFor('Anna Clyne')).toBeNull();
    expect(portraitFor(null)).toBeNull();
  });
});

describe('the portrait table', () => {
  it('only ever keys on a canonical name', () => {
    // A row keyed on "Beethoven" or "beethoven" would never be found: lookup
    // goes through `canonical`, which returns the full name. Empty today, so
    // this is the guard for the row somebody adds later.
    for (const key of Object.keys(PORTRAITS)) {
      expect(COMPOSERS.some((c) => c.name === key), `${key} is not a canonical name`).toBe(true);
    }
  });
});
