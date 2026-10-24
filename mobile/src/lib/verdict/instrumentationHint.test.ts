import { describe, expect, it } from 'vitest';

import { shouldShowInstrumentationHint } from './instrumentationHint';

describe('shouldShowInstrumentationHint', () => {
  it('shows the hint when the signal is flagged', () => {
    expect(shouldShowInstrumentationHint(true)).toBe(true);
  });

  it('shows nothing when the pipeline checked and found nothing', () => {
    expect(shouldShowInstrumentationHint(false)).toBe(false);
  });

  it('shows nothing for an older, un-migrated, or failed computation', () => {
    expect(shouldShowInstrumentationHint(null)).toBe(false);
  });
});
