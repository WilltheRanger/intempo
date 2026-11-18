import { describe, expect, it } from 'vitest';

import { BROWSER_TRANSITION_WINDOW_MS, browserJustAnimated } from './browserBack';

describe('browserJustAnimated', () => {
  it('is true for the render that follows the browser’s own transition', () => {
    expect(browserJustAnimated(1000, 990)).toBe(true);
    expect(browserJustAnimated(1000, 1000)).toBe(true);
  });

  it('is false once the window has passed, so a later in-app back still slides', () => {
    expect(browserJustAnimated(1000 + BROWSER_TRANSITION_WINDOW_MS, 1000)).toBe(false);
  });

  it('is false when the browser never reported a transition', () => {
    expect(browserJustAnimated(1000, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});
