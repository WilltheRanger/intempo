import { describe, expect, it } from 'vitest';

import { isInstrument } from './instruments';
import type { Instrument } from './types';

/**
 * The guard two device stores read storage through.
 *
 * The exhaustiveness — that the list cannot fall behind the `Instrument` union
 * — is a compile-time guarantee and is deliberately **not** restated here: a
 * runtime test of it would pass on a tree that does not compile, which is
 * worse than no test. Verified by breaking it instead: adding a fifth member
 * to the union in `types.ts` makes `tsc` name the missing key in
 * `instruments.ts`, and the file was restored byte-identically after.
 *
 * What is worth checking at runtime is the other half — what the guard does
 * with the things storage actually hands back.
 */
describe('reading an instrument off storage', () => {
  it('accepts every instrument this build offers', () => {
    const every: Record<Instrument, true> = {
      violin: true,
      viola: true,
      cello: true,
      double_bass: true,
    };
    for (const name of Object.keys(every)) {
      expect(isInstrument(name)).toBe(true);
    }
  });

  it('rejects what a half-written or older store leaves behind', () => {
    // Storage outlives the code that wrote it. Every one of these is a shape a
    // real store has produced somewhere: a missing key, a cleared value, a
    // renamed instrument, a whole object where a string was expected.
    for (const junk of [undefined, null, '', 'Violin', 'bass', 'harp', 0, {}, ['violin']]) {
      expect(isInstrument(junk)).toBe(false);
    }
  });

  it('is not fooled by a property every object has', () => {
    // `INSTRUMENTS.includes` is immune to this and a `key in object` check
    // would not be — worth pinning, because the second is the obvious
    // "optimisation" of the first.
    expect(isInstrument('toString')).toBe(false);
    expect(isInstrument('constructor')).toBe(false);
  });
});
