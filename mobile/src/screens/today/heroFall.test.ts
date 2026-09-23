import { describe, expect, it } from 'vitest';

import { FALL_START, MIN_START, SETTLED_WASH, fallStops, washAt } from './heroFall';

const HEIGHT = 844;

describe('fallStops', () => {
  it('is the prototype’s fall before anything is measured', () => {
    const stops = fallStops(0, null);
    expect(stops[1]).toEqual([FALL_START, 0]);
    expect(washAt(stops, 0.75)).toBeCloseTo(0.984);
    expect(washAt(stops, 0.3)).toBe(0);
  });

  it('stays where the prototype put it for copy that starts low', () => {
    const stops = fallStops(HEIGHT, 0.7 * HEIGHT);
    expect(stops[1][0]).toBe(FALL_START);
  });

  it('moves the prototype’s own layout only a little', () => {
    // Its sample puts the label at about 59%, where its fall is about 0.8
    // settled — just short of what the label needs — so it rises, by a few
    // points, not a redesign's worth.
    const stops = fallStops(HEIGHT, 0.59 * HEIGHT);
    expect(stops[1][0]).toBeLessThan(FALL_START);
    expect(FALL_START - stops[1][0]).toBeLessThan(0.06);
  });

  it('rises to meet copy that starts high, so the first line is on settled ivory', () => {
    // A two-line title with its composer and last take: the block starts at 47%.
    const copyTop = 0.47 * HEIGHT;
    const stops = fallStops(HEIGHT, copyTop);
    expect(stops[1][0]).toBeLessThan(FALL_START);
    expect(washAt(stops, copyTop / HEIGHT)).toBeGreaterThanOrEqual(SETTLED_WASH);
  });

  it('never climbs into the greeting', () => {
    const stops = fallStops(HEIGHT, 0.1 * HEIGHT);
    expect(stops[1][0]).toBe(MIN_START);
  });

  it('keeps its offsets in order and inside the hero', () => {
    for (const top of [null, 0, 200, 400, 600, 800]) {
      const offsets = fallStops(HEIGHT, top).map(([offset]) => offset);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
      expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
    }
  });

  it('ends fully ivory at the bottom edge', () => {
    expect(washAt(fallStops(HEIGHT, 400), 1)).toBe(1);
  });
});
