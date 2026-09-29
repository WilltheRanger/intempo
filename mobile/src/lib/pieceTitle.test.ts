import { describe, expect, it } from 'vitest';

import { REPERTOIRE } from './repertoire';
import { charsPerLine, nameLines, splitTitle } from './pieceTitle';

describe('splitTitle', () => {
  it('takes the catalogue number off the end', () => {
    expect(splitTitle('Sonata No. 1 in G minor, BWV 1001')).toEqual({
      name: 'Sonata No. 1 in G minor',
      catalogue: 'BWV 1001',
    });
    expect(splitTitle('Concerto in A minor, Op. 3 No. 6')).toEqual({
      name: 'Concerto in A minor',
      catalogue: 'Op. 3 No. 6',
    });
    expect(splitTitle('Minuet in G, WoO 10 No. 2').catalogue).toBe('WoO 10 No. 2');
    expect(splitTitle('Sonata in A minor, D. 385').catalogue).toBe('D. 385');
  });

  it('leaves a title without one alone, commas and all', () => {
    expect(splitTitle('Twinkle, Twinkle, Little Star Variations')).toEqual({
      name: 'Twinkle, Twinkle, Little Star Variations',
      catalogue: null,
    });
    // "No. 2" of a set is part of the name, not a catalogue.
    expect(splitTitle('42 Études ou Caprices, No. 2').catalogue).toBeNull();
  });

  it('never leaves a name empty', () => {
    for (const work of REPERTOIRE) {
      expect(splitTitle(work.title).name.length, work.title).toBeGreaterThan(0);
    }
  });
});

describe('nameLines', () => {
  const heading = charsPerLine(342, 42);

  it('breaks a long name before its key, not through it', () => {
    expect(nameLines('Sonata No. 1 in G minor', heading)).toEqual(['Sonata No. 1', 'in G minor']);
    expect(nameLines('Cello Suite No. 4 in E-flat major', heading)).toEqual([
      'Cello Suite No. 4',
      'in E-flat major',
    ]);
  });

  it('keeps a name that fits on one line', () => {
    expect(nameLines('Sonata No. 1 in G minor', charsPerLine(342, 26))).toEqual([
      'Sonata No. 1 in G minor',
    ]);
  });

  it('leaves a name with no key, or halves that will not fit, to wrap', () => {
    expect(nameLines('School of Violin Technique for Beginners', heading)).toHaveLength(1);
    expect(nameLines('Concerto for Two Violins in A minor', 10)).toHaveLength(1);
  });
});
