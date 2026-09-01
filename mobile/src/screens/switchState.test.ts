import { describe, expect, it } from 'vitest';

/**
 * Every switch says whether it is on.
 *
 * **react-native-web emits `aria-checked` and does not derive it from
 * `accessibilityState`.** A control with `accessibilityRole="switch"` and only
 * `accessibilityState={{ checked }}` announces its label and never its state —
 * so a screen-reader user is told there is a switch called "Reduce motion" and
 * not whether reducing motion is on.
 *
 * This has been found three times: `PieceScoreScreen` and `RecordScreen` each
 * carry a comment about it, `ToggleRow` was fixed when the profile was audited,
 * and the measure editor's rest toggle had it wrong the whole time in between.
 * Three discoveries of one fact is what a test is for.
 *
 * Read as source text because there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24) — the same approach `cameraResolution.test.ts`
 * takes to the expo-camera patch.
 */
/**
 * `import.meta.glob` is Vite's and is a **compile-time** transform: it has to
 * be called literally, right here, or it is not replaced at all and the test
 * silently finds nothing. This project has no `vite/client` types, so it is
 * declared rather than aliased — an alias typechecks and then matches no files.
 */
declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

const sources = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const components = import.meta.glob('../components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Comments out, before anything is scanned.
 *
 * **This test passed while the thing it checks was broken**, because the
 * comment explaining `aria-checked` sits inside the very element it describes —
 * so removing the prop left the word behind and the assertion found it. A
 * source-text test that reads its own documentation as evidence proves nothing.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** The props of one JSX element, from `<Name` to the matching `>`. */
function elementsWithSwitchRole(raw: string): string[] {
  const source = withoutComments(raw);
  const out: string[] = [];
  let at = source.indexOf('accessibilityRole="switch"');
  while (at !== -1) {
    // Back to the opening `<`, forward to the end of the props.
    const start = source.lastIndexOf('<', at);
    const end = source.indexOf('>', at);
    out.push(source.slice(start, end === -1 ? source.length : end));
    at = source.indexOf('accessibilityRole="switch"', at + 1);
  }
  return out;
}

const all = { ...sources, ...components };

/** Only the files that actually declare a switch — with the switches in them. */
const withSwitches = Object.entries(all)
  .map(([file, raw]) => [file, elementsWithSwitchRole(raw)] as const)
  .filter(([, elements]) => elements.length > 0);

describe('switches', () => {
  it('finds the switches it is meant to be checking', () => {
    // A glob that silently matches nothing would leave `withSwitches` empty and
    // `it.each` with no cases — a suite that reports green while checking
    // nothing at all. Both halves are asserted: the files and the controls.
    expect(withSwitches.length).toBeGreaterThan(2);
    expect(withSwitches.flatMap(([, elements]) => elements).length).toBeGreaterThan(2);
  });

  // Over the files that have switches, not over every `.tsx` in the tree: a
  // hundred passing cases that examined nothing would bury the handful that do.
  it.each(withSwitches)('%s carries aria-checked on every switch', (file, elements) => {
    for (const element of elements) {
      // `aria-checked=`, with the equals: the prop, not a mention of it.
      expect(element, `a switch in ${file} has no aria-checked`).toContain(
        'aria-checked=',
      );
    }
  });
});
