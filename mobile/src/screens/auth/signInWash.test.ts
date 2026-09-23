import { describe, expect, it } from 'vitest';

import { signInWash, SOLID_FROM } from './signInWash';

/** The ivory at a fraction of the height, read off the stops. */
function washAt(stops: [number, number][], at: number): number {
  for (let i = 1; i < stops.length; i += 1) {
    const [x1, y1] = stops[i];
    if (at <= x1) {
      const [x0, y0] = stops[i - 1];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
    }
  }
  return stops[stops.length - 1][1];
}

describe('signInWash', () => {
  it('is the prototype’s wash when nothing has been measured', () => {
    const stops = signInWash(0, null);
    expect(stops[0]).toEqual([0, 0]);
    expect(washAt(stops, SOLID_FROM)).toBe(1);
    expect(washAt(stops, 0.21)).toBeCloseTo(0.3, 2);
  });

  it('keeps the prototype’s wash when the form starts below it', () => {
    // The 844pt phone it was drawn for: the form's title at about 365.
    expect(signInWash(844, 370)).toEqual(signInWash(0, null));
  });

  /**
   * The case it exists for: a shorter phone puts the form's first line above
   * 38%, and the prototype's wash would leave it on the photograph.
   */
  it('is solid under the form on a shorter phone', () => {
    const height = 667;
    const formTop = 150;
    const stops = signInWash(height, formTop);
    expect(washAt(stops, formTop / height)).toBe(1);
    expect(washAt(stops, (formTop - 20) / height)).toBe(1);
  });

  it('still fades rather than cutting when it has to start high', () => {
    const stops = signInWash(667, 150);
    const top = stops[0][1];
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(1);
    const offsets = stops.map(([offset]) => offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('never runs past the top of the screen', () => {
    const stops = signInWash(600, 10);
    expect(stops.every(([offset]) => offset >= 0 && offset <= 1)).toBe(true);
    expect(washAt(stops, 0)).toBe(1);
  });
});
