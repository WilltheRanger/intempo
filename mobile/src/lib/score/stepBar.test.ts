import { describe, expect, it } from 'vitest';

import { canStepBar, stepBar } from './stepBar';

describe('stepping through the bars a take can start on', () => {
  it('walks the list, not the numbers', () => {
    // Bar 13 is all rest and is not in the list. The bar after 12 is 14.
    expect(stepBar([1, 2, 12, 14, 15], 12, 1)).toBe(14);
    expect(stepBar([1, 2, 12, 14, 15], 14, -1)).toBe(12);
  });

  it('stops at either end rather than wrapping', () => {
    expect(stepBar([3, 4, 5], 5, 1)).toBe(5);
    expect(stepBar([3, 4, 5], 3, -1)).toBe(3);
    expect(canStepBar([3, 4, 5], 5, 1)).toBe(false);
    expect(canStepBar([3, 4, 5], 3, -1)).toBe(false);
    expect(canStepBar([3, 4, 5], 4, 1)).toBe(true);
  });

  it('lands on the first bar when the current one is not in the list', () => {
    // The score changed underneath a remembered choice.
    expect(stepBar([4, 5, 6], 99, 1)).toBe(4);
  });

  it('does nothing with nothing to step through', () => {
    expect(stepBar([], 7, 1)).toBe(7);
  });
});
