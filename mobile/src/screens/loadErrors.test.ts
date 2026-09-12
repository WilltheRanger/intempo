import { describe, expect, it } from 'vitest';

/**
 * A screen that failed to load offers a way to try again.
 *
 * **The tabs all told a musician to check their connection and gave them
 * nothing to press.** Today, Library, Insights and Profile each rendered an
 * `EmptyState` with `describeLoadError(...)` and no action. Pull-to-refresh is
 * the unwritten answer, and it is invisible; on the web build with a mouse it
 * does not exist at all. `AccountStartupScreen` has had a "Try again" button
 * since it was written, so the pattern was never in doubt — it just was not
 * applied to the four screens a musician actually lives in.
 *
 * A flaky connection is the ordinary case on a phone, which makes this the
 * most-reached broken state in the app rather than an edge one.
 *
 * Source text, for the same reason as `ariaState.test.ts`: there is no React
 * Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
const screens = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Every `<EmptyState … />` in a file, as the text of its props.
 *
 * `/>` rather than `>` as the terminator: props hold arrow functions, and
 * stopping at the first `>` would cut the element off at `() =>`.
 */
function emptyStates(raw: string): string[] {
  const source = withoutComments(raw);
  const out: string[] = [];
  let at = source.indexOf('<EmptyState');
  while (at !== -1) {
    const end = source.indexOf('/>', at);
    out.push(source.slice(at, end === -1 ? source.length : end));
    at = source.indexOf('<EmptyState', at + 1);
  }
  return out;
}

/** The ones that exist because a fetch failed. */
const failures = Object.entries(screens)
  .map(
    ([file, raw]) =>
      [file, emptyStates(raw).filter((el) => el.includes('describeLoadError('))] as const,
  )
  .filter(([, states]) => states.length > 0);

describe('a load failure', () => {
  it('is found on the screens it is meant to be checked on', () => {
    // A glob that matched nothing would leave `it.each` with no cases and the
    // suite green. Four screens had this bug; the count must not fall below
    // what is known to exist.
    expect(failures.length).toBeGreaterThanOrEqual(4);
  });

  it.each(failures)('%s offers a way to try again', (file, states) => {
    for (const state of states) {
      expect(state, `a load error in ${file} has no action`).toContain(
        'actionLabel=',
      );
      expect(state, `a load error in ${file} has a label and no handler`).toContain(
        'onActionPress=',
      );
    }
  });
});
