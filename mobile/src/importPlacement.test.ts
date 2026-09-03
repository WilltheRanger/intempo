import { describe, expect, it } from 'vitest';

/**
 * Every `import` starts its own line.
 *
 * `LibraryScreen.tsx` ended with:
 *
 * ```
 * });import { describeLoadError } from '../../data/api/describeError';
 * ```
 *
 * — an import appended to the closing line of the stylesheet by a bad
 * automated edit. It **worked**: imports are hoisted, so the module resolved,
 * the screen rendered, `tsc` was clean and every suite passed. It survived
 * three commits.
 *
 * There is no ESLint in this tree, which is why nothing said anything. This is
 * the narrow guard for the one thing that actually happened rather than a
 * substitute for a linter: an import must be the first thing on its line. A
 * file that grows one anywhere else is the same botched edit, and the next
 * person to touch that line finds it the hard way.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

// Vite's own reader, the same one `ariaState.test.ts` and `loadErrors.test.ts`
// use. `node:fs` would need `@types/node`, which this tree does not carry —
// and a test that only typechecks with a new dependency is a worse guard than
// the thing it guards.
const files: Record<string, string> = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('import placement', () => {
  it('finds the source tree at all', () => {
    // Without this the check below passes over an empty list, which is the
    // failure mode every sweep in this repository is written to avoid.
    expect(Object.keys(files).length).toBeGreaterThan(200);
  });

  it('never has an import sharing a line with other code', () => {
    const offenders: string[] = [];

    for (const [file, source] of Object.entries(files)) {
      source
        .split('\n')
        .forEach((line: string, index: number) => {
          // Comment lines first, and not as an afterthought: the docstring
          // above quotes the offending line verbatim, so the first version of
          // this check reported itself. Requiring `from '…'` was supposed to
          // skip prose — it does not, because prose about an import quotes the
          // whole statement.
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) {
            return;
          }
          if (/\S+.*\bimport\s.*\bfrom\s+['"]/.test(line) && !/^\s*import\s/.test(line)) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });
    }

    expect(offenders).toEqual([]);
  });
});
