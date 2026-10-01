import { describe, expect, it } from 'vitest';

import type { Instrument } from '../data/types';
import { INSTRUMENT_LABELS } from './warmup';

/**
 * The instruments, named the same way wherever they are named.
 *
 * **There used to be three hand-written lists** — `INSTRUMENT_LABELS`, the
 * onboarding grid and Profile's four-way switch — and this file held the two
 * controls to the same four values in the same order, allowing exactly one
 * divergence: the switch's "Bass", because four segments across a phone had
 * no room for "Double bass".
 *
 * The saxophones (2026-10-01) ended that: a switch cannot take six. Both
 * controls now read `lib/instrumentGroups.ts` for *which* instruments and in
 * what order, and `INSTRUMENT_LABELS` for *what to call them*. So the rules
 * here are that no control types a list of its own again, and that every name
 * is the full one.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

const files: Record<string, string> = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const EVERY: Record<Instrument, true> = {
  violin: true,
  viola: true,
  cello: true,
  double_bass: true,
  alto_sax: true,
  tenor_sax: true,
};

const CONTROLS = [
  '../components/profile/InstrumentChoice.tsx',
  '../components/profile/InstrumentSheet.tsx',
];

describe('what the app calls each instrument', () => {
  it('has a full name for every one of them', () => {
    expect(Object.keys(INSTRUMENT_LABELS).sort()).toEqual(Object.keys(EVERY).sort());
    expect(INSTRUMENT_LABELS.double_bass).toBe('Double bass');
    expect(INSTRUMENT_LABELS.alto_sax).toBe('Alto saxophone');
    expect(INSTRUMENT_LABELS.tenor_sax).toBe('Tenor saxophone');
  });

  it.each(CONTROLS)('reads the shared list and the shared names — %s', (path) => {
    const source = files[path];
    expect(source, `${path} is not in the glob`).toBeTruthy();
    expect(source).toMatch(/INSTRUMENT_GROUPS/);
    expect(source).toMatch(/INSTRUMENT_LABELS\[/);
  });

  it('is not typed out as a list of options anywhere', () => {
    // `{ value: 'violin', label: 'Violin' }` was the shape of both copies.
    // A third one is how a control ends up missing the saxophones.
    const offenders = Object.entries(files)
      .filter(([, source]) =>
        /\{\s*value:\s*'(violin|viola|cello|double_bass|alto_sax|tenor_sax)'/.test(source),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('is offered from Profile through the sheet', () => {
    const profile = files['../screens/profile/ProfileScreen.tsx'];
    expect(profile).toMatch(/<InstrumentSheet/);
    expect(profile).not.toMatch(/label:\s*'Bass'/);
  });
});
