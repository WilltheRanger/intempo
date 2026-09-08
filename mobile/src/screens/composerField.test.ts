import { describe, expect, it } from 'vitest';

/**
 * Every composer is entered through the same field.
 *
 * `ComposerField` offers the repertoire as you type and settles on one
 * spelling — which is the point: four ways of writing Bach are four rows and
 * four covers in a library, and `portraitFor` matches on the canonical name.
 *
 * **Three of the four screens that ask for a composer used a bare `Input`**,
 * including the two that actually add pieces. The one that had the good field
 * was `ManualPieceForm`, the least-used route of the three, and the worst
 * omission was the MusicXML import — where the name arrives *out of the file*
 * as "J.S. Bach" or "BACH" or "Johann Sebastian Bach (1685-1750)", so it is
 * the route most likely to produce a variant spelling and it offered no way to
 * settle it.
 *
 * Source text, for the same reason as `ariaState.test.ts` and
 * `loadErrors.test.ts`: there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24).
 */
const screens = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const components = import.meta.glob('../components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const all = { ...screens, ...components };

/** Files that render a field asking for a composer, however they do it. */
const asking = Object.entries(all)
  .map(([file, raw]) => [file, withoutComments(raw)] as const)
  .filter(([, source]) => source.includes('label="Composer"') || source.includes('<ComposerField'));

describe('the composer field', () => {
  it('is asked for on the screens it is meant to be asked for on', () => {
    // Manual add, MusicXML import, naming a scan, and renaming a piece — plus
    // the component itself. A glob matching nothing would make every case
    // below pass vacuously.
    expect(asking.length).toBeGreaterThanOrEqual(4);
  });

  it.each(asking)('%s asks through ComposerField', (file, source) => {
    // `ComposerField` is the only thing allowed to carry the bare label: it is
    // the component that renders it.
    if (file.includes('ComposerField.tsx')) {
      return;
    }
    expect(source, `${file} asks for a composer with a plain Input`).toContain(
      '<ComposerField',
    );
    expect(source, `${file} still has a bare composer Input`).not.toContain(
      'label="Composer"',
    );
  });
});
