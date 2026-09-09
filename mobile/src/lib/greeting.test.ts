import { describe, expect, it } from 'vitest';

import { getGreeting } from './greeting';

/**
 * The first words on the Today screen, and the boundaries nobody had checked.
 *
 * Three branches on `getHours()`, which means two boundaries, which means two
 * off-by-ones available — and both are the kind that a person notices and a
 * screenshot does not, because a screenshot is taken at one time of day.
 */

/** A local time, since `getGreeting` reads the device's clock. */
const at = (hour: number, minute = 0) => new Date(2026, 8, 9, hour, minute);

describe('the greeting', () => {
  it('says morning from midnight', () => {
    // The edge a test written at a sensible hour would never reach.
    expect(getGreeting(at(0))).toBe('Good morning');
    expect(getGreeting(at(0, 0))).toBe('Good morning');
  });

  it('is still morning at one minute to noon', () => {
    expect(getGreeting(at(11, 59))).toBe('Good morning');
  });

  it('turns to afternoon exactly at noon', () => {
    // Not 12:01. Noon belongs to the afternoon, and `< 12` is what says so.
    expect(getGreeting(at(12))).toBe('Good afternoon');
  });

  it('is still afternoon at one minute to six', () => {
    expect(getGreeting(at(17, 59))).toBe('Good afternoon');
  });

  it('turns to evening exactly at six', () => {
    expect(getGreeting(at(18))).toBe('Good evening');
  });

  it('is still evening at one minute to midnight', () => {
    expect(getGreeting(at(23, 59))).toBe('Good evening');
  });

  it('says one of exactly three things, all day', () => {
    // No fourth greeting, and no hour that falls through to something else.
    const said = new Set(Array.from({ length: 24 }, (_, h) => getGreeting(at(h))));
    expect(said).toEqual(new Set(['Good morning', 'Good afternoon', 'Good evening']));
  });
});
