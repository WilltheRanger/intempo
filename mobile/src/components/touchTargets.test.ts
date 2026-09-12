import { describe, expect, it } from 'vitest';

/**
 * No control relies on `hitSlop` to reach the minimum target.
 *
 * **It has no effect under react-native-web**, which is the build these
 * screens are driven and shipped in today. Measured in Chromium on the
 * password screen's Show control: a click 8pt above it — well inside its 12pt
 * slop — did not activate it, while a click on the visible 18pt box did.
 *
 * `MIN_TOUCH_TARGET`'s own comment recommended `hitSlop` until this was
 * measured, and eight controls followed that advice: the search field's clear
 * button, every section header's action, the password reveal, and all five
 * links on the sign-in screen — one line of type each, at 18pt, less than half
 * the platform minimum. Two other files had already found this out and written
 * it down beside their own fix.
 *
 * Source text, like `ariaState.test.ts` and `goBack.test.ts`: there is no
 * React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
const tree = {
  ...import.meta.glob('./**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../screens/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../navigation/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
};

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('touch targets', () => {
  it('reads the tree it is meant to be checking', () => {
    // A glob matching nothing would make the assertion below pass vacuously.
    expect(Object.keys(tree).length).toBeGreaterThan(40);
  });

  it('are never made with hitSlop', () => {
    const offenders = Object.entries(tree)
      .filter(([, raw]) => /\bhitSlop\b/.test(withoutComments(raw)))
      .map(([file]) => file);

    expect(offenders, 'hitSlop does nothing on the web build — pad the control instead').toEqual([]);
  });
});
