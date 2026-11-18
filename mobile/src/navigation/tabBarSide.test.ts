import { describe, expect, it } from 'vitest';

import { tabBarSide } from './tabBarSide';

// The design's own numbers, written out: a test that imported them from
// `design/index.ts` would pull in `react-native`, which vitest cannot parse.
const COLUMN = 560;
const INSET = 12;

describe('where the tab bar sits across the window', () => {
  it('floats its inset from the edges of a phone', () => {
    expect(tabBarSide(375, COLUMN, INSET)).toBe(12);
    expect(tabBarSide(430, COLUMN, INSET)).toBe(12);
  });

  it('is exactly the column, less its inset, once the window is wider than the column', () => {
    // 12pt in from each side of the column, as from each side of a phone.
    expect(tabBarSide(COLUMN, COLUMN, INSET)).toBe(12);
    const side = tabBarSide(1440, COLUMN, INSET);
    expect(side).toBe(452);
    expect(1440 - 2 * side).toBe(COLUMN - 2 * INSET);
  });

  it('never comes closer to the edge than its inset', () => {
    expect(tabBarSide(320, COLUMN, INSET)).toBe(12);
    expect(tabBarSide(0, COLUMN, INSET)).toBe(12);
  });
});
