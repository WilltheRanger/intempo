import { describe, expect, it } from 'vitest';

import type { Instrument } from '../data/types';
import { INSTRUMENT_LABELS } from './warmup';

/**
 * The four bowed strings, named the same way wherever they are named.
 *
 * There are **three** lists of them in this app and each was typed out by
 * hand: `INSTRUMENT_LABELS` (rendered on Today and the Warmup screen), the
 * grid in `components/profile/InstrumentChoice.tsx`, and the segmented control
 * in `screens/profile/ProfileScreen.tsx`.
 *
 * The two controls **disagree on purpose** and both say why:
 *
 * > "Double bass" in full: a bassist does not call it "Bass", and this is the
 * > one control where the space exists to say so.
 *
 * > "Bass" rather than "Double bass" in the control: four segments across a
 * > phone leave no room for the longer word … The full name is used everywhere
 * > it fits.
 *
 * That is one coherent rule — full name where it fits, short form in the
 * four-across control — held in two places that cannot see each other. What
 * nothing held is the rest of it: the same four values, in score order, with
 * no *undocumented* divergence. A fifth list, or a relabelled viola in one
 * screen and not the other, is the "screens drift apart one fix at a time"
 * failure `walk-app.mjs` exists for, and the walk cannot see a label that is
 * merely inconsistent.
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

/** Score order, highest to lowest — not alphabetical, and not by accident. */
const SCORE_ORDER: Instrument[] = ['violin', 'viola', 'cello', 'double_bass'];

/**
 * Where a control deliberately says something shorter, and where only there.
 *
 * Delete an entry when the control is reworded; add one only with the reason
 * written beside the list itself, the way both existing ones are.
 */
const DELIBERATELY_SHORTER: Record<string, Partial<Record<Instrument, string>>> = {
  '../screens/profile/ProfileScreen.tsx': { double_bass: 'Bass' },
};

/** `{ value: 'violin', label: 'Violin' }` pairs, in the order they appear. */
function optionsIn(path: string): [Instrument, string][] {
  const source = files[path];
  expect(source, `${path} is not in the glob`).toBeTruthy();
  return [
    ...source.matchAll(
      /\{\s*value:\s*'(\w+)'(?:\s+as\s+const)?,\s*label:\s*'([^']+)'\s*\}/g,
    ),
  ]
    .filter(([, value]) => (SCORE_ORDER as string[]).includes(value))
    .map((match) => [match[1] as Instrument, match[2]]);
}

const CONTROLS = [
  '../components/profile/InstrumentChoice.tsx',
  '../screens/profile/ProfileScreen.tsx',
];

describe('what the app calls each instrument', () => {
  it('has a canonical full name for every one of them', () => {
    expect(Object.keys(INSTRUMENT_LABELS).sort()).toEqual([...SCORE_ORDER].sort());
  });

  it.each(CONTROLS)('offers all four in score order — %s', (path) => {
    const options = optionsIn(path);
    // Vacuity: a regex that matched nothing would satisfy every rule below.
    expect(options).toHaveLength(SCORE_ORDER.length);
    expect(options.map(([value]) => value)).toEqual(SCORE_ORDER);
  });

  it.each(CONTROLS)('uses the full name except where it says otherwise — %s', (path) => {
    const shorter = DELIBERATELY_SHORTER[path] ?? {};

    for (const [value, label] of optionsIn(path)) {
      const expected = shorter[value] ?? INSTRUMENT_LABELS[value];
      expect(label, `${path} calls ${value} "${label}"`).toBe(expected);
    }
  });

  it('lists no shortening that is not actually there', () => {
    // The other direction: a control reworded to the full name leaves an entry
    // above claiming a divergence that no longer exists — the same rot as a
    // stale `NOT_WIRED` line or a stale `KNOWN_ECHOES` entry.
    for (const [path, overrides] of Object.entries(DELIBERATELY_SHORTER)) {
      const labels = new Map(optionsIn(path));
      for (const [value, short] of Object.entries(overrides)) {
        expect(labels.get(value as Instrument), `${path} no longer shortens ${value}`).toBe(
          short,
        );
      }
    }
  });
});
