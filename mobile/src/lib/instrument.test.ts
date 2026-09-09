import { describe, expect, it } from 'vitest';

import { clefFor } from './instrument';
import type { Clef, Instrument } from '../data/types';

/**
 * Which staff a hand-entered piece is filed under.
 *
 * The module's own docstring says how this fails: *"a piece filed under the
 * wrong clef renders on the wrong staff, and nothing else about the app
 * misbehaves"*. Silent, and on the one route into the library that needs no
 * camera — so it is the route somebody uses when a page will not photograph.
 *
 * These pin the **policy**, which is the part a reader might reasonably think
 * is wrong and "tidy": a cello reads tenor and treble as a part climbs, and a
 * double bass sounds an octave below what is written. Both are true, and
 * neither changes the staff a piece is written on by default.
 */

describe('the staff each instrument reads', () => {
  it('files a violin part in treble', () => {
    expect(clefFor('violin')).toBe('treble');
  });

  it('files a viola part in alto, not treble', () => {
    // The one that is neither of the two obvious answers, and the one whose
    // being wrong `engrave.ts` warns about: "a viola part arrives and every
    // note sits a third off".
    expect(clefFor('viola')).toBe('alto');
  });

  it('files a cello part in bass, though a cellist also reads tenor', () => {
    expect(clefFor('cello')).toBe('bass');
  });

  it('files a double bass part in bass, written an octave above sounding', () => {
    expect(clefFor('double_bass')).toBe('bass');
  });

  it('answers for every instrument this build offers', () => {
    // `Record<Instrument, Clef>` already makes a missing entry a `tsc` error;
    // this catches the other half — an entry present and undefined at runtime,
    // which the type cannot see.
    const every: Record<Instrument, true> = {
      violin: true,
      viola: true,
      cello: true,
      double_bass: true,
    };
    const clefs: Clef[] = ['treble', 'alto', 'tenor', 'bass'];
    for (const instrument of Object.keys(every) as Instrument[]) {
      expect(clefs).toContain(clefFor(instrument));
    }
  });
});
