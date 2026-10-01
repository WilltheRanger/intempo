import { describe, expect, it } from 'vitest';

import type { Instrument } from '../data/types';
import { INSTRUMENT_GROUPS } from './instrumentGroups';

/** Every instrument, as a map `tsc` holds to the union in `types.ts`. */
const EVERY: Record<Instrument, true> = {
  violin: true,
  viola: true,
  cello: true,
  double_bass: true,
  alto_sax: true,
  tenor_sax: true,
};

describe('the instruments a musician can choose', () => {
  it('offers every instrument exactly once', () => {
    // An instrument the union has and no group lists is one nobody can pick;
    // one listed twice is two rows that both look selected.
    const offered = INSTRUMENT_GROUPS.flatMap((group) => group.instruments);
    expect([...offered].sort()).toEqual(Object.keys(EVERY).sort());
    expect(new Set(offered).size).toBe(offered.length);
  });

  it('puts the strings first, highest to lowest, then the winds', () => {
    expect(INSTRUMENT_GROUPS.map((group) => group.label)).toEqual(['Strings', 'Winds']);
    expect(INSTRUMENT_GROUPS[0].instruments).toEqual(['violin', 'viola', 'cello', 'double_bass']);
    expect(INSTRUMENT_GROUPS[1].instruments).toEqual(['alto_sax', 'tenor_sax']);
  });

  it('has no empty group', () => {
    for (const group of INSTRUMENT_GROUPS) {
      expect(group.instruments.length, group.label).toBeGreaterThan(0);
    }
  });
});
