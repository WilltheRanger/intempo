import { describe, expect, it } from 'vitest';

import { REFRESH_AFTER_AWAY_MS, shouldRefreshOnReturn } from './returnRefresh';

describe('shouldRefreshOnReturn', () => {
  it('refreshes a screen the app left long enough ago to have changed', () => {
    expect(shouldRefreshOnReturn(0, REFRESH_AFTER_AWAY_MS)).toBe(true);
    expect(shouldRefreshOnReturn(0, REFRESH_AFTER_AWAY_MS * 50)).toBe(true);
  });

  it('leaves a quick tab switch alone, which is the request a sleeping host pays for', () => {
    expect(shouldRefreshOnReturn(0, 5_000)).toBe(false);
    expect(shouldRefreshOnReturn(0, REFRESH_AFTER_AWAY_MS - 1)).toBe(false);
  });

  it('does nothing when the page was never hidden', () => {
    expect(shouldRefreshOnReturn(null, REFRESH_AFTER_AWAY_MS * 2)).toBe(false);
  });
});
