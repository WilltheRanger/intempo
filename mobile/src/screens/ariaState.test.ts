import { describe, expect, it } from 'vitest';

/**
 * Every control that has a state announces it.
 *
 * **react-native-web does not derive ARIA state from `accessibilityState`.** A
 * control with `accessibilityRole="switch"` and only
 * `accessibilityState={{ checked }}` announces its label and never whether it
 * is on — so a screen-reader user is told there is a switch called "Reduce
 * motion" and not whether reducing motion is on. The same is true of
 * `selected` on a tab and of a radio's `checked`.
 *
 * **This fact has now been found four times.** `PieceScoreScreen` and
 * `RecordScreen` each carry a comment about it, `ToggleRow` was fixed when the
 * profile was audited, the measure editor's rest toggle had it wrong the whole
 * time in between — and when this test only covered switches, an audit of the
 * score screen found **nine** more controls stating a `selected` state that
 * nothing emitted: both tab bars, the clef chooser, the instrument choice, the
 * note and duration pickers, the bar picker, the scanner's flash, and the
 * verdict rows. The bottom tab bar announced four identical tabs.
 *
 * Which attribute depends on the role, and getting that wrong is as silent as
 * omitting it — `aria-selected` on a plain button is ignored by assistive
 * technology. So this checks the pairing, not merely the presence.
 *
 * Read as source text because there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24) — the same approach `cameraResolution.test.ts`
 * and `loadErrors.test.ts` take.
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

const navigation = import.meta.glob('../navigation/**/*.tsx', {
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

/** The ARIA attribute a role has to carry, by what the role is. */
const ATTRIBUTE_FOR_ROLE: Record<string, string> = {
  switch: 'aria-checked=',
  checkbox: 'aria-checked=',
  radio: 'aria-checked=',
  tab: 'aria-selected=',
  button: 'aria-pressed=',
};

interface Stateful {
  role: string;
  element: string;
}

/**
 * Every JSX element that declares an `accessibilityState`, with its role.
 *
 * From the opening `<` back of the state prop to the end of the props. `>` is
 * the terminator rather than `/>` because most of these elements have children;
 * an arrow function in the props would cut it short, so `=>` is skipped over.
 */
function statefulElements(raw: string): Stateful[] {
  const source = withoutComments(raw);
  const out: Stateful[] = [];
  let at = source.indexOf('accessibilityState=');
  while (at !== -1) {
    const start = source.lastIndexOf('<', at);
    let end = at;
    for (;;) {
      end = source.indexOf('>', end + 1);
      if (end === -1) {
        end = source.length;
        break;
      }
      if (source[end - 1] !== '=') {
        break; // not the `>` of an arrow function
      }
    }
    const element = source.slice(start, end);
    const role = /accessibilityRole="(\w+)"/.exec(element)?.[1] ?? '';
    out.push({ role, element });
    at = source.indexOf('accessibilityState=', at + 1);
  }
  return out;
}

const all = { ...sources, ...components, ...navigation };

/** Only the files that declare a state, with the elements that declare one. */
const stateful = Object.entries(all)
  .map(([file, raw]) => [file, statefulElements(raw)] as const)
  .filter(([, elements]) => elements.length > 0);

describe('a control with a state', () => {
  it('is found on the files it is meant to be checked on', () => {
    // A glob that matched nothing would leave `it.each` with no cases and the
    // suite green. Ten files carried one when this was written.
    expect(stateful.length).toBeGreaterThanOrEqual(8);
    expect(stateful.flatMap(([, e]) => e).length).toBeGreaterThanOrEqual(10);
  });

  it.each(stateful)('%s announces it', (file, elements) => {
    for (const { role, element } of elements) {
      // `disabled` and `busy` are honoured natively by react-native-web; only
      // the two that are not are checked here.
      if (!/\b(checked|selected)\b/.test(element)) {
        continue;
      }
      const attribute = ATTRIBUTE_FOR_ROLE[role];
      if (!attribute) {
        // A role decided at render time — `MeasureRow` is a button only when
        // it has a figure to reveal. This cannot say *which* attribute is
        // right, so it asks for one of them and leaves the pairing to review.
        expect(
          element,
          `a control in ${file} has a state and a role this test cannot read, and no ARIA state at all`,
        ).toMatch(/aria-(checked|selected|pressed)=/);
        continue;
      }
      expect(
        element,
        `a ${role} in ${file} has no ${attribute.replace('=', '')}`,
      ).toContain(attribute);
    }
  });
});
