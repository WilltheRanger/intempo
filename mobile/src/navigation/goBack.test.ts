import { describe, expect, it } from 'vitest';

/**
 * Every back control has somewhere to go.
 *
 * **`navigation.goBack()` does nothing on the first screen of a stack**, and
 * arriving directly at a screen is the ordinary case in the web build on
 * Cloudflare Pages. Measured in Chromium: opening `/legal/privacy`,
 * `/add/manual`, `/help`, `/warmup` or `/pieces/:id/bars/3` and pressing the
 * back control left the page exactly where it was.
 *
 * Worse than a dead button, because those labels are specific: "Back to
 * score", "Back to profile" and "Back to today" each named a destination and
 * went nowhere. `useGoBack` makes the label true.
 *
 * Source text, for the same reason as `ariaState.test.ts` and
 * `loadErrors.test.ts`: there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24).
 */
const screens = import.meta.glob('../screens/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const offenders = Object.entries(screens)
  .map(([file, raw]) => [file, withoutComments(raw)] as const)
  .filter(([, source]) => source.includes('navigation.goBack()'));

// `useBackButton` is `useGoBack` with the navigation bar's word attached
// (2026-11-13); either keeps the fallback.
const usingHook = Object.entries(screens).filter(([, raw]) =>
  /\buse(GoBack|BackButton)\(/.test(withoutComments(raw)),
);

describe('going back', () => {
  it('is never a bare goBack in a screen', () => {
    expect(
      offenders.map(([file]) => file),
      'these would do nothing on a screen opened directly',
    ).toEqual([]);
  });

  it('is wired through the hook wherever a screen offers it', () => {
    // A glob that matched nothing would make the assertion above pass while
    // checking nothing. Twenty screens had a back control when this was
    // written.
    expect(usingHook.length).toBeGreaterThanOrEqual(15);
  });
});
