import { describe, expect, it } from 'vitest';

import {
  PULL_START,
  PULL_TRIGGER,
  SPINNER_TICKS,
  pullDistance,
  pullProgress,
  startsRefresh,
  ticksShown,
} from './pullToRefresh';

describe('the pull', () => {
  it('is how far past its top the page has been pulled', () => {
    expect(pullDistance(-40)).toBe(40);
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(120)).toBe(0);
  });

  it('shows nothing for the first few points, then fills to the trigger', () => {
    expect(pullProgress(PULL_START)).toBe(0);
    expect(pullProgress((PULL_START + PULL_TRIGGER) / 2)).toBeCloseTo(0.5);
    expect(pullProgress(PULL_TRIGGER)).toBe(1);
    expect(pullProgress(PULL_TRIGGER * 2)).toBe(1);
  });
});

describe('the spinner', () => {
  it('draws its ticks one by one as the pull lengthens', () => {
    expect(ticksShown(0)).toBe(0);
    expect(ticksShown(0.01)).toBe(1);
    expect(ticksShown(0.5)).toBe(SPINNER_TICKS / 2);
    expect(ticksShown(1)).toBe(SPINNER_TICKS);
  });
});

describe('starting a refresh', () => {
  it('happens at the trigger, mid-pull', () => {
    expect(startsRefresh(PULL_TRIGGER, true, false)).toBe(true);
    expect(startsRefresh(PULL_TRIGGER - 1, true, false)).toBe(false);
  });

  it('happens once per pull, and not over one already running', () => {
    expect(startsRefresh(PULL_TRIGGER + 40, false, false)).toBe(false);
    expect(startsRefresh(PULL_TRIGGER + 40, true, true)).toBe(false);
  });
});
