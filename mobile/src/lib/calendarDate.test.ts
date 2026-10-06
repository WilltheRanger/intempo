import { describe, expect, it } from 'vitest';

import { longDate, shortDate } from './calendarDate';

describe('calendar dates', () => {
  // Local-time constructors, so the day is the same wherever this runs.
  const sep18 = new Date(2026, 8, 18, 12);
  const jan1 = new Date(2027, 0, 1, 12);

  it('writes the short form month first', () => {
    expect(shortDate(sep18)).toBe('Sep 18');
    expect(shortDate(jan1)).toBe('Jan 1');
  });

  it('writes the long form month first', () => {
    expect(longDate(sep18)).toBe('September 18');
    expect(longDate(jan1)).toBe('January 1');
  });
});
