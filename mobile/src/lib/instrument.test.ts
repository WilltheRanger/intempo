import { describe, expect, it } from 'vitest';

import { clefFor, soundingOffset } from './instrument';
import type { Clef, Instrument } from '../data/types';
// `?raw`: the project has no `@types/node`, so `readFileSync` does not
// typecheck. Same pattern as `cameraResolution.test.ts`.
import analysisSource from '../../../backend/app/services/analysis.py?raw';

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

  it('files both saxophone parts in treble, as written', () => {
    // A tenor sounds a ninth below its page, down in bass-clef territory, and
    // is still printed in treble so its fingerings match the alto's.
    expect(clefFor('alto_sax')).toBe('treble');
    expect(clefFor('tenor_sax')).toBe('treble');
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
      alto_sax: true,
      tenor_sax: true,
    };
    const clefs: Clef[] = ['treble', 'alto', 'tenor', 'bass'];
    for (const instrument of Object.keys(every) as Instrument[]) {
      expect(clefs).toContain(clefFor(instrument));
    }
  });
});

describe('how far below the page each instrument sounds', () => {
  it('moves a double bass an octave and each saxophone by its own interval', () => {
    expect(soundingOffset('violin')).toBe(0);
    expect(soundingOffset('double_bass')).toBe(-12);
    // Alto in E-flat: written C sounds the E-flat a major sixth below.
    expect(soundingOffset('alto_sax')).toBe(-9);
    // Tenor in B-flat: written C sounds the B-flat a major ninth below.
    expect(soundingOffset('tenor_sax')).toBe(-14);
  });

  it('agrees with the analysis, which listens for the same sounding pitch', () => {
    // Playback and analysis each hold a copy: the app plays a note where
    // `soundingOffset` puts it, and the server listens for it where
    // `_TRANSPOSE` does. If the two disagree, Listen teaches the musician a
    // pitch the verdict then marks wrong.
    const table = /^_TRANSPOSE: dict\[str, int\] = \{([^}]*)\}/m.exec(analysisSource);
    expect(table, '_TRANSPOSE not found in analysis.py').not.toBeNull();
    const backend = Object.fromEntries(
      [...table![1].matchAll(/"(\w+)":\s*(-?\d+)/g)].map(([, name, st]) => [name, Number(st)]),
    );
    const every: Instrument[] = ['violin', 'viola', 'cello', 'double_bass', 'alto_sax', 'tenor_sax'];
    for (const instrument of every) {
      expect(backend[instrument] ?? 0, instrument).toBe(soundingOffset(instrument));
    }
  });
});
