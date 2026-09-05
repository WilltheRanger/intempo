import { describe, expect, it } from 'vitest';

import { LICENCES } from './licences';

/**
 * The licence page is generated, and a generated file with no check drifts.
 *
 * `expo-system-ui` was a dependency of this app for as long as the splash
 * background has been set, and it was **not on the licence page** — because
 * `scripts/generate-licences.mjs` is run by hand and nobody re-ran it. Nothing
 * failed: the screen rendered, the list looked complete, and the one package
 * missing from it was the one added most recently. That is how every hand-run
 * generator fails, and the fix is not "remember next time".
 *
 * This holds the two directions that matter for a notice shown to users:
 * everything the app depends on is listed, and everything listed is something
 * the app actually depends on. It deliberately does **not** check versions —
 * those come from the installed tree, and a test that reads `node_modules`
 * would fail for a reason that has nothing to do with what shipped.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

// Vite's reader rather than `node:fs`, the same way `importPlacement.test.ts`
// reads source: this tree carries no `@types/node`.
const manifest = Object.values(
  import.meta.glob('../../package.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0];

const pkg = JSON.parse(manifest) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const declared = [
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.devDependencies),
];

/**
 * Things the app ships that npm has never heard of.
 *
 * There are two of these lists — `VENDORED` in the generator writes the file
 * and this one reads it — and the two rules below hold them together without
 * anyone remembering to: a name added to the generator alone is not declared
 * in `package.json` either, so it fails the stale check, and a name added here
 * alone fails the check that it is listed. Bravura is the entry that legally
 * matters: the OFL requires the notice, and a page listing thirty MIT packages
 * while dropping the one file with an attribution requirement would be
 * backwards.
 */
const VENDORED_NAMES = [
  'Bravura (music font)',
  'GeneralUser GS (string SoundFonts)',
];

const listed = LICENCES.map((entry) => entry.name);

describe('the licence page', () => {
  it('lists something', () => {
    // Every rule below is a set comparison, and two empty sets agree. If the
    // import ever resolves to nothing this says so instead of passing.
    expect(LICENCES.length).toBeGreaterThan(20);
    expect(declared.length).toBeGreaterThan(20);
  });

  it('names every package the app declares', () => {
    const missing = declared.filter((name) => !listed.includes(name)).sort();

    expect(missing, 'run `node scripts/generate-licences.mjs`').toEqual([]);
  });

  it('names nothing the app does not ship', () => {
    // The other direction: a package removed from `package.json` leaves its
    // attribution behind, and the page then tells users the app is built on
    // something it no longer contains.
    const stale = listed
      .filter(
        (name) => !declared.includes(name) && !VENDORED_NAMES.includes(name),
      )
      .sort();

    expect(stale, 'run `node scripts/generate-licences.mjs`').toEqual([]);
  });

  it('keeps the vendored attributions the generator cannot see', () => {
    for (const name of VENDORED_NAMES) {
      expect(listed, name).toContain(name);
    }
  });

  it('gives every entry a version and a licence', () => {
    for (const entry of LICENCES) {
      expect(entry.version, entry.name).not.toBe('');
      expect(entry.licence, entry.name).not.toBe('');
      // What the generator writes when a package's manifest states its licence
      // in a shape it cannot read. Useful to a maintainer, useless on a screen
      // whose whole purpose is to say what the licence is.
      expect(entry.licence, entry.name).not.toBe('See package');
    }
  });

  it('has no duplicate entries', () => {
    expect(listed.length).toBe(new Set(listed).size);
  });
});
